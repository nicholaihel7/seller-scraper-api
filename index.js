const express = require('express');
const puppeteer = require('puppeteer-core');

const app = express();
app.use(express.json());

// Browserless.io API key
const BROWSERLESS_API_KEY = process.env.BROWSERLESS_API_KEY || '2TmzgHbydVgViER0f5ab63f96b42f7d44336645122c956006';

// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Browserless'a bağlan
async function getBrowser() {
  return await puppeteer.connect({
    browserWSEndpoint: `wss://chrome.browserless.io?token=${BROWSERLESS_API_KEY}`,
  });
}

// Platform tespit
function detectPlatform(url) {
  if (url.includes('trendyol.com')) return 'Trendyol';
  if (url.includes('hepsiburada.com')) return 'Hepsiburada';
  if (url.includes('n11.com')) return 'N11';
  if (url.includes('amazon.com.tr')) return 'Amazon TR';
  return 'Diğer';
}

// Tek URL scrape
async function scrapeSeller(url) {
  const platform = detectPlatform(url);
  let browser;
  
  try {
    browser = await getBrowser();
    const page = await browser.newPage();
    
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1920, height: 1080 });
    
    // Gereksiz kaynakları engelle - hız için
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if (['image', 'stylesheet', 'font'].includes(req.resourceType())) {
        req.abort();
      } else {
        req.continue();
      }
    });
    
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    
    // Sayfanın JS'inin çalışması için bekle
    await new Promise(r => setTimeout(r, 8000));
    
    let result = {
      url,
      platform,
      seller: null,
      price: null,
      priceText: null,
      title: null,
      rating: null,
      isOfficial: false,
      isTrusted: false,
      success: false
    };

    if (platform === 'Trendyol') {
      result = await page.evaluate((baseResult) => {
        // Trendyol JSON verisini script tag'inden çek
        const scripts = document.querySelectorAll('script');
        let productData = null;
        
        for (const script of scripts) {
          const text = script.textContent || '';
          // __PRODUCT_DETAIL_APP_INITIAL_STATE__ veya window.__INITIAL_STATE__ ara
          if (text.includes('PRODUCT_DETAIL') || text.includes('INITIAL_STATE')) {
            try {
              // JSON objesini bul
              const match = text.match(/window\.__PRODUCT_DETAIL_APP_INITIAL_STATE__\s*=\s*({.+?});/s) ||
                           text.match(/window\.__INITIAL_STATE__\s*=\s*({.+?});/s);
              if (match) {
                productData = JSON.parse(match[1]);
                break;
              }
            } catch (e) {}
          }
        }
        
        // JSON'dan veri çek
        if (productData) {
          try {
            const product = productData.product || productData;
            
            // Satıcı adı
            if (product.merchant?.name) {
              baseResult.seller = product.merchant.name;
            } else if (product.seller?.name) {
              baseResult.seller = product.seller.name;
            }
            
            // Fiyat
            if (product.price?.sellingPrice) {
              baseResult.price = product.price.sellingPrice.value || product.price.sellingPrice;
              baseResult.priceText = baseResult.price.toLocaleString('tr-TR') + ' TL';
            } else if (product.price?.originalPrice) {
              baseResult.price = product.price.originalPrice.value || product.price.originalPrice;
              baseResult.priceText = baseResult.price.toLocaleString('tr-TR') + ' TL';
            }
            
            // Ürün adı
            if (product.name) {
              baseResult.title = product.name;
            }
            
            // Rating
            if (product.ratingScore?.averageRating) {
              baseResult.rating = product.ratingScore.averageRating.toString();
            }
            
            // Marka mağazası mı?
            baseResult.isOfficial = product.merchant?.isOfficialBrand || false;
            
          } catch (e) {}
        }
        
        // Fallback: JSON bulunamazsa HTML'den çek
        if (!baseResult.price) {
          const allText = document.body.innerText;
          const priceMatch = allText.match(/(\d{1,3}\.?\d{3})\s*TL/);
          if (priceMatch) {
            baseResult.priceText = priceMatch[0];
            baseResult.price = parseFloat(priceMatch[1].replace('.', ''));
          }
        }
        
        if (!baseResult.title) {
          const h1 = document.querySelector('h1');
          if (h1) {
            baseResult.title = h1.textContent.trim();
          }
        }
        
        if (!baseResult.seller) {
          // Script içinden satıcı bilgisini ara
          const pageSource = document.documentElement.innerHTML;
          
          // Direkt "name":"XXX" pattern - Troy, Apple, Yetkili içerenler
          let sellerMatch = pageSource.match(/"name"\s*:\s*"([^"]*(?:Troy|Yetkili|Official|Resmi)[^"]*)"/i);
          
          // "merchantName":"XXX" formatı
          if (!sellerMatch) {
            sellerMatch = pageSource.match(/"merchantName"\s*:\s*"([^"]{2,50})"/);
          }
          
          // Genel merchant/seller objesinden name çek
          if (!sellerMatch) {
            sellerMatch = pageSource.match(/"merchant"\s*:\s*\{[^}]*"name"\s*:\s*"([^"]+)"/);
          }
          
          if (sellerMatch && sellerMatch[1]) {
            const seller = sellerMatch[1];
            // Kargo, indirim, kampanya gibi kelimeleri içeriyorsa atla
            if (!seller.includes('Kargo') && !seller.includes('Bedava') && !seller.includes('indirim') && !seller.includes('Kampanya')) {
              baseResult.seller = seller;
            }
          }
        }
        
        baseResult.success = !!(baseResult.price || baseResult.title);
        return baseResult;
      }, result);
      
    } else if (platform === 'Hepsiburada') {
      result = await page.evaluate((baseResult) => {
        // Fiyat
        const priceEl = document.querySelector('[data-test-id="price-current-price"], [class*="price"] span');
        if (priceEl) {
          baseResult.priceText = priceEl.textContent.trim();
          const match = baseResult.priceText.match(/[\d\.]+/);
          if (match) {
            baseResult.price = parseFloat(match[0].replace('.', ''));
          }
        }
        
        // Satıcı
        const sellerEl = document.querySelector('[data-test-id="merchant-name"], [class*="merchant"]');
        if (sellerEl) {
          baseResult.seller = sellerEl.textContent.trim();
        }
        
        // Ürün adı
        const titleEl = document.querySelector('h1');
        if (titleEl) {
          baseResult.title = titleEl.textContent.trim();
        }
        
        baseResult.success = !!(baseResult.price || baseResult.title);
        return baseResult;
      }, result);
      
    } else if (platform === 'N11') {
      result = await page.evaluate((baseResult) => {
        const priceEl = document.querySelector('.newPrice ins, [class*="price"]');
        if (priceEl) {
          baseResult.priceText = priceEl.textContent.trim();
          const match = baseResult.priceText.match(/[\d\.]+/);
          if (match) {
            baseResult.price = parseFloat(match[0].replace('.', ''));
          }
        }
        
        const sellerEl = document.querySelector('.seller-name, [class*="shop"]');
        if (sellerEl) {
          baseResult.seller = sellerEl.textContent.trim();
        }
        
        const titleEl = document.querySelector('h1');
        if (titleEl) {
          baseResult.title = titleEl.textContent.trim();
        }
        
        baseResult.success = !!(baseResult.price || baseResult.title);
        return baseResult;
      }, result);
    }

    await browser.close();
    return result;
    
  } catch (error) {
    if (browser) await browser.close();
    return {
      url,
      platform,
      error: error.message,
      success: false
    };
  }
}

// Health check
app.get('/', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'Seller Scraper API',
    version: '3.1.0',
    provider: 'Browserless.io',
    endpoints: ['/api/scrape', '/api/scrape-multiple', '/health']
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Tek URL scrape endpoint
app.get('/api/scrape', async (req, res) => {
  const { url } = req.query;
  
  if (!url) {
    return res.status(400).json({ error: 'URL parametresi gerekli' });
  }
  
  const result = await scrapeSeller(url);
  res.json(result);
});

// Çoklu URL scrape endpoint
app.post('/api/scrape-multiple', async (req, res) => {
  const { urls } = req.body;
  
  if (!urls || !Array.isArray(urls)) {
    return res.status(400).json({ error: 'urls array gerekli' });
  }
  
  const results = [];
  
  for (const url of urls.slice(0, 10)) { // Max 10 URL
    const result = await scrapeSeller(url);
    results.push(result);
  }
  
  // Özet istatistikler
  const successful = results.filter(r => r.success);
  const sellers = [...new Set(successful.map(r => r.seller).filter(Boolean))];
  const prices = successful.map(r => r.price).filter(Boolean);
  const avgPrice = prices.length ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : null;
  
  res.json({
    totalScraped: results.length,
    successfulScrapes: successful.length,
    uniqueSellers: sellers.length,
    averagePrice: avgPrice,
    sellers: results
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Seller Scraper API v3.1 running on port ${PORT}`);
  console.log('Using Browserless.io for Chrome');
});

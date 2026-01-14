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
    version: '4.0.0',
    provider: 'Browserless.io',
    endpoints: ['/api/scrape', '/api/scrape-multiple', '/api/all-sellers', '/health']
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

// TÜM SATICILARI ÇEK - Trendyol için
app.get('/api/all-sellers', async (req, res) => {
  const { url } = req.query;
  
  if (!url) {
    return res.status(400).json({ error: 'URL parametresi gerekli' });
  }
  
  if (!url.includes('trendyol.com')) {
    return res.status(400).json({ error: 'Şu an sadece Trendyol destekleniyor' });
  }
  
  let browser;
  
  try {
    browser = await getBrowser();
    const page = await browser.newPage();
    
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1920, height: 1080 });
    
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    
    // Sayfanın yüklenmesi için bekle
    await new Promise(r => setTimeout(r, 5000));
    
    // "Diğer Satıcılar" sekmesine tıkla
    try {
      await page.click('[data-testid="other-sellers-tab"], [class*="other-sellers"], a[href*="diger-saticilar"]');
      await new Promise(r => setTimeout(r, 2000));
    } catch (e) {
      // Sekme yoksa devam et
    }
    
    // "Tüm Satıcıları Göster" butonuna tıkla
    try {
      await page.waitForSelector('[data-testid="other-seller-button"], button.see-all-button-see-all-button', { timeout: 5000 });
      await page.click('[data-testid="other-seller-button"], button.see-all-button-see-all-button');
      await new Promise(r => setTimeout(r, 3000));
    } catch (e) {
      // Buton yoksa devam et
    }
    
    // Tüm satıcıları çek
    const result = await page.evaluate(() => {
      const sellers = [];
      
      // Ürün adını al
      const titleEl = document.querySelector('h1, [class*="product-name"]');
      const productTitle = titleEl?.textContent?.trim() || '';
      
      // Ana satıcı (sayfadaki varsayılan)
      const mainPrice = document.querySelector('[class*="prc-dsc"], [class*="product-price"]');
      const mainSeller = document.querySelector('[class*="merchant"] a, [class*="seller-name"]');
      
      if (mainPrice) {
        const priceText = mainPrice.textContent.trim();
        const priceMatch = priceText.match(/[\d\.]+/);
        sellers.push({
          seller: mainSeller?.textContent?.trim() || 'Ana Satıcı',
          price: priceMatch ? parseFloat(priceMatch[0].replace('.', '')) : null,
          priceText: priceText,
          rating: null,
          isMain: true
        });
      }
      
      // Diğer satıcılar bölümünden çek - Trendyol slider yapısı
      const sellerCards = document.querySelectorAll('[data-testid="box"].other-merchant-item-box, div.other-merchant-item-box, [class*="other-merchant-item-box"]');
      
      sellerCards.forEach(card => {
        // Satıcı adı - ilk link veya başlık
        const nameEl = card.querySelector('a[href*="/magaza/"], [class*="merchant-name"], span[class*="title"]');
        // Fiyat
        const priceEl = card.querySelector('[class*="prc"], span[class*="price"]');
        // Puan - genelde mavi badge içinde
        const ratingEl = card.querySelector('[class*="rating"], [class*="score"], span[class*="slf"]');
        
        let sellerName = '';
        let price = null;
        let priceText = '';
        let rating = null;
        
        // Satıcı adını bul
        if (nameEl) {
          sellerName = nameEl.textContent.trim();
        } else {
          // Kart içindeki ilk anlamlı text
          const allText = card.textContent;
          const nameMatch = allText.match(/^([A-Za-zığüşöçİĞÜŞÖÇ\s]+)/);
          if (nameMatch) sellerName = nameMatch[1].trim();
        }
        
        // Fiyatı bul
        if (priceEl) {
          priceText = priceEl.textContent.trim();
        } else {
          const allText = card.textContent;
          const priceMatch = allText.match(/([\d\.]+)\s*TL/);
          if (priceMatch) {
            priceText = priceMatch[0];
            price = parseFloat(priceMatch[1].replace('.', ''));
          }
        }
        
        if (!price && priceText) {
          const match = priceText.match(/([\d\.]+)/);
          if (match) price = parseFloat(match[1].replace('.', ''));
        }
        
        // Puanı bul
        const cardText = card.textContent;
        const ratingMatch = cardText.match(/(\d[,\.]\d)/);
        if (ratingMatch) rating = ratingMatch[1];
        
        // Geçerli satıcıları ekle
        if (sellerName && sellerName.length > 2 && !sellerName.includes('Kargo') && !sellerName.includes('Teslim') && !sellerName.includes('Fatura')) {
          sellers.push({
            seller: sellerName.split('\n')[0].trim(), // İlk satırı al
            price: price,
            priceText: priceText,
            rating: rating,
            isMain: false
          });
        }
      });
      
      // HTML'den JSON verisini de dene
      const pageSource = document.documentElement.innerHTML;
      const merchantMatches = pageSource.matchAll(/"merchantName"\s*:\s*"([^"]+)"[^}]*"sellingPrice"\s*:\s*(\d+)/g);
      
      for (const match of merchantMatches) {
        const existingSeller = sellers.find(s => s.seller === match[1]);
        if (!existingSeller) {
          sellers.push({
            seller: match[1],
            price: parseInt(match[2]),
            priceText: parseInt(match[2]).toLocaleString('tr-TR') + ' TL',
            rating: null,
            isMain: false
          });
        }
      }
      
      return {
        productTitle,
        sellers,
        totalSellers: sellers.length
      };
    });
    
    await browser.close();
    
    // Duplicate satıcıları temizle (aynı isim + aynı fiyat olanları kaldır)
    const uniqueSellers = [];
    const seen = new Set();
    
    for (const seller of result.sellers) {
      const key = `${seller.seller}-${seller.price}`;
      // Fiyatı olmayanları ve 1000 TL altındakileri atla (geçersiz fiyat)
      if (!seen.has(key) && seller.price && seller.price > 1000) {
        seen.add(key);
        uniqueSellers.push(seller);
      }
    }
    
    result.sellers = uniqueSellers;
    result.totalSellers = uniqueSellers.length;
    
    // Fiyata göre sırala
    result.sellers.sort((a, b) => (a.price || 999999) - (b.price || 999999));
    
    // En ucuz ve en pahalı
    const prices = result.sellers.map(s => s.price).filter(Boolean);
    result.cheapest = prices.length ? Math.min(...prices) : null;
    result.mostExpensive = prices.length ? Math.max(...prices) : null;
    result.success = result.sellers.length > 0;
    result.platform = 'Trendyol';
    result.url = url;
    
    res.json(result);
    
  } catch (error) {
    if (browser) await browser.close();
    res.status(500).json({
      error: error.message,
      success: false
    });
  }
});

// TRENDYOL ARAMA - Ürün adına göre tüm sonuçları çek
app.get('/api/search', async (req, res) => {
  const { q, platform = 'trendyol', limit = 50 } = req.query;
  
  if (!q) {
    return res.status(400).json({ error: 'q (arama sorgusu) parametresi gerekli' });
  }
  
  let browser;
  
  try {
    browser = await getBrowser();
    const page = await browser.newPage();
    
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1920, height: 1080 });
    
    let searchUrl = '';
    if (platform === 'trendyol') {
      searchUrl = `https://www.trendyol.com/sr?q=${encodeURIComponent(q)}`;
    } else if (platform === 'hepsiburada') {
      searchUrl = `https://www.hepsiburada.com/ara?q=${encodeURIComponent(q)}`;
    } else {
      return res.status(400).json({ error: 'Desteklenen platformlar: trendyol, hepsiburada' });
    }
    
    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 60000 });
    await new Promise(r => setTimeout(r, 3000));
    
    // Sayfayı aşağı kaydır - daha fazla ürün yüklemek için
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.scrollBy(0, 1000));
      await new Promise(r => setTimeout(r, 1000));
    }
    
    let products = [];
    
    if (platform === 'trendyol') {
      products = await page.evaluate((maxLimit) => {
        const items = [];
        const productCards = document.querySelectorAll('[data-id], .p-card-wrppr, [class*="product-card"]');
        
        productCards.forEach((card, index) => {
          if (index >= maxLimit) return;
          
          const titleEl = card.querySelector('[class*="prdct-desc-cntnr-name"], [class*="product-name"], span[title]');
          const priceEl = card.querySelector('[class*="prc-box-dscntd"], [class*="price"]');
          const sellerEl = card.querySelector('[class*="merchant"], [class*="seller"]');
          const linkEl = card.querySelector('a[href*="/p-"]');
          const ratingEl = card.querySelector('[class*="rating"], [class*="score"]');
          const imageEl = card.querySelector('img[src*="cdn"]');
          
          const title = titleEl?.textContent?.trim() || titleEl?.getAttribute('title') || '';
          const priceText = priceEl?.textContent?.trim() || '';
          const priceMatch = priceText.match(/([\d\.]+)/);
          const price = priceMatch ? parseFloat(priceMatch[1].replace('.', '')) : null;
          
          const href = linkEl?.getAttribute('href') || '';
          const fullUrl = href.startsWith('http') ? href : 'https://www.trendyol.com' + href;
          
          const ratingText = ratingEl?.textContent?.trim() || '';
          const ratingMatch = ratingText.match(/([\d,\.]+)/);
          
          if (title && price && price > 1000) {
            items.push({
              title: title,
              price: price,
              priceText: price.toLocaleString('tr-TR') + ' TL',
              seller: sellerEl?.textContent?.trim() || null,
              rating: ratingMatch ? ratingMatch[1] : null,
              url: fullUrl,
              image: imageEl?.src || null,
              platform: 'Trendyol'
            });
          }
        });
        
        return items;
      }, parseInt(limit));
    }
    
    await browser.close();
    
    // Fiyata göre sırala
    products.sort((a, b) => a.price - b.price);
    
    const prices = products.map(p => p.price).filter(Boolean);
    
    res.json({
      query: q,
      platform: platform,
      totalProducts: products.length,
      cheapest: prices.length ? Math.min(...prices) : null,
      mostExpensive: prices.length ? Math.max(...prices) : null,
      products: products,
      success: products.length > 0
    });
    
  } catch (error) {
    if (browser) await browser.close();
    res.status(500).json({
      error: error.message,
      success: false
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Seller Scraper API v4.0 running on port ${PORT}`);
  console.log('Using Browserless.io for Chrome');
});

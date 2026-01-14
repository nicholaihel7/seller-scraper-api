const express = require('express');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');

const app = express();
app.use(express.json());

// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Browser başlat
async function getBrowser() {
  return await puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
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
    
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    
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
        // Satıcı adı
        const sellerEl = document.querySelector('.merchant-text, .seller-name-text, [data-testid="merchant-name"]');
        baseResult.seller = sellerEl?.textContent?.trim() || null;
        
        // Fiyat
        const priceEl = document.querySelector('.prc-dsc, .product-price-container span');
        baseResult.priceText = priceEl?.textContent?.trim() || null;
        if (baseResult.priceText) {
          baseResult.price = parseFloat(baseResult.priceText.replace(/[^\d,]/g, '').replace(',', '.'));
        }
        
        // Ürün adı
        const titleEl = document.querySelector('.pr-new-br h1, .product-name');
        baseResult.title = titleEl?.textContent?.trim() || null;
        
        // Rating
        const ratingEl = document.querySelector('.rating-score');
        baseResult.rating = ratingEl?.textContent?.trim() || null;
        
        // Resmi mağaza kontrolü
        baseResult.isOfficial = !!document.querySelector('.official-store-badge, .seller-badge');
        baseResult.isTrusted = !!document.querySelector('.trusted-seller, .seller-badge');
        
        baseResult.success = !!(baseResult.seller || baseResult.price);
        return baseResult;
      }, result);
      
    } else if (platform === 'Hepsiburada') {
      result = await page.evaluate((baseResult) => {
        // Satıcı adı
        const sellerEl = document.querySelector('.merchant-name, [data-test-id="merchant-name"], .seller-name');
        baseResult.seller = sellerEl?.textContent?.trim() || null;
        
        // Fiyat
        const priceEl = document.querySelector('[data-test-id="price-current-price"], .product-price');
        baseResult.priceText = priceEl?.textContent?.trim() || null;
        if (baseResult.priceText) {
          baseResult.price = parseFloat(baseResult.priceText.replace(/[^\d,]/g, '').replace(',', '.'));
        }
        
        // Ürün adı
        const titleEl = document.querySelector('h1[data-test-id="product-name"], .product-name');
        baseResult.title = titleEl?.textContent?.trim() || null;
        
        // Rating
        const ratingEl = document.querySelector('.rating-score, [data-test-id="rating-score"]');
        baseResult.rating = ratingEl?.textContent?.trim() || null;
        
        baseResult.isOfficial = !!document.querySelector('.hb-store-badge');
        baseResult.isTrusted = !!document.querySelector('.trusted-badge');
        
        baseResult.success = !!(baseResult.seller || baseResult.price);
        return baseResult;
      }, result);
      
    } else if (platform === 'N11') {
      result = await page.evaluate((baseResult) => {
        const sellerEl = document.querySelector('.seller-name, .shopName');
        baseResult.seller = sellerEl?.textContent?.trim() || null;
        
        const priceEl = document.querySelector('.newPrice ins, .price');
        baseResult.priceText = priceEl?.textContent?.trim() || null;
        if (baseResult.priceText) {
          baseResult.price = parseFloat(baseResult.priceText.replace(/[^\d,]/g, '').replace(',', '.'));
        }
        
        const titleEl = document.querySelector('.proName, h1.product-name');
        baseResult.title = titleEl?.textContent?.trim() || null;
        
        baseResult.success = !!(baseResult.seller || baseResult.price);
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
    version: '2.0.0',
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
  console.log(`Seller Scraper API running on port ${PORT}`);
});

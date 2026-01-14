const express = require('express');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Puppeteer browser instance
let browser = null;

async function getBrowser() {
  if (!browser) {
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-zygote',
        '--single-process'
      ]
    });
  }
  return browser;
}

// Trendyol satıcı bilgisi çekme
async function scrapeTrendyol(page, url) {
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  
  const data = await page.evaluate(() => {
    // Satıcı adı
    const sellerEl = document.querySelector('a.merchant-text') || 
                     document.querySelector('.seller-name-text') ||
                     document.querySelector('[data-testid="merchant-name"]') ||
                     document.querySelector('.merchant-box a');
    
    // Fiyat (indirimli öncelikli)
    const priceEl = document.querySelector('span.prc-dsc') || 
                    document.querySelector('span.prc-org') ||
                    document.querySelector('.product-price-container span');
    
    // Ürün adı
    const titleEl = document.querySelector('h1.pr-new-br') ||
                    document.querySelector('.product-name') ||
                    document.querySelector('h1');
    
    // Satıcı puanı
    const ratingEl = document.querySelector('.seller-rating') ||
                     document.querySelector('.merchant-rating');
    
    // Resmi satıcı rozeti
    const officialBadge = document.querySelector('.official-store') ||
                          document.querySelector('.verified-seller') ||
                          document.querySelector('[data-testid="official-store-badge"]');
    
    return {
      seller: sellerEl ? sellerEl.textContent.trim() : null,
      price: priceEl ? priceEl.textContent.trim() : null,
      title: titleEl ? titleEl.textContent.trim() : null,
      rating: ratingEl ? ratingEl.textContent.trim() : null,
      isOfficial: !!officialBadge
    };
  });
  
  return data;
}

// Hepsiburada satıcı bilgisi çekme
async function scrapeHepsiburada(page, url) {
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  
  const data = await page.evaluate(() => {
    // Satıcı adı
    const sellerEl = document.querySelector('.merchant-name') ||
                     document.querySelector('.seller-name') ||
                     document.querySelector('[data-test="merchant-name"]') ||
                     document.querySelector('.merchant-box-wrapper a');
    
    // Fiyat
    const priceEl = document.querySelector('[data-testid="price-current-price"]') ||
                    document.querySelector('.product-price') ||
                    document.querySelector('.price-value');
    
    // Ürün adı
    const titleEl = document.querySelector('h1[data-test="product-name"]') ||
                    document.querySelector('.product-name') ||
                    document.querySelector('h1');
    
    // Satıcı puanı
    const ratingEl = document.querySelector('.merchant-rating') ||
                     document.querySelector('.seller-rating');
    
    return {
      seller: sellerEl ? sellerEl.textContent.trim() : null,
      price: priceEl ? priceEl.textContent.trim() : null,
      title: titleEl ? titleEl.textContent.trim() : null,
      rating: ratingEl ? ratingEl.textContent.trim() : null,
      isOfficial: false
    };
  });
  
  return data;
}

// N11 satıcı bilgisi çekme
async function scrapeN11(page, url) {
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  
  const data = await page.evaluate(() => {
    // Satıcı adı
    const sellerEl = document.querySelector('.seller-name') ||
                     document.querySelector('.sellerName') ||
                     document.querySelector('.store-name a');
    
    // Fiyat
    const priceEl = document.querySelector('.newPrice') ||
                    document.querySelector('.price ins') ||
                    document.querySelector('.productPrice');
    
    // Ürün adı
    const titleEl = document.querySelector('.proName') ||
                    document.querySelector('h1.product-name') ||
                    document.querySelector('h1');
    
    // Satıcı puanı
    const ratingEl = document.querySelector('.seller-rating') ||
                     document.querySelector('.store-rating');
    
    return {
      seller: sellerEl ? sellerEl.textContent.trim() : null,
      price: priceEl ? priceEl.textContent.trim() : null,
      title: titleEl ? titleEl.textContent.trim() : null,
      rating: ratingEl ? ratingEl.textContent.trim() : null,
      isOfficial: false
    };
  });
  
  return data;
}

// Geçersiz satıcı adlarını filtrele
function isValidSeller(seller) {
  if (!seller) return false;
  
  const invalidNames = [
    'trendyol', 'hepsiburada', 'n11', 'amazon', 
    'satıcı', 'seller', 'mağaza', 'store',
    '', ' '
  ];
  
  const lowerSeller = seller.toLowerCase().trim();
  
  if (invalidNames.includes(lowerSeller)) return false;
  if (seller.length < 2 || seller.length > 100) return false;
  if (/^[0-9]+$/.test(seller)) return false;
  
  return true;
}

// Güvenilir satıcı listesi
const trustedSellers = [
  'mediamarkt', 'vatan bilgisayar', 'teknosa', 'apple store', 'samsung store',
  'watsons', 'gratis', 'rossmann', 'sephora', 'eve',
  'p&g', 'unilever', 'loreal', 'eczacıbaşı', 'nivea', 'garnier',
  'migros', 'carrefour', 'a101', 'bim', 'şok',
  'nike', 'adidas', 'puma', 'decathlon',
  'ikea', 'koçtaş', 'bauhaus'
];

function isTrustedSeller(seller) {
  if (!seller) return false;
  const lowerSeller = seller.toLowerCase().trim();
  return trustedSellers.some(trusted => lowerSeller.includes(trusted));
}

// Fiyatı sayıya çevir
function parsePrice(priceStr) {
  if (!priceStr) return null;
  
  // "59.249,99 TL" -> 59249.99
  const cleaned = priceStr
    .replace(/[^\d.,]/g, '')
    .replace(/\.(?=\d{3})/g, '')
    .replace(',', '.');
  
  const price = parseFloat(cleaned);
  return isNaN(price) ? null : price;
}

// Tek URL scrape endpoint
app.get('/api/scrape', async (req, res) => {
  const { url } = req.query;
  
  if (!url) {
    return res.status(400).json({ error: 'URL gerekli' });
  }
  
  try {
    const browserInstance = await getBrowser();
    const page = await browserInstance.newPage();
    
    // User agent ayarla
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    let data = null;
    let platform = null;
    
    if (url.includes('trendyol.com')) {
      platform = 'Trendyol';
      data = await scrapeTrendyol(page, url);
    } else if (url.includes('hepsiburada.com')) {
      platform = 'Hepsiburada';
      data = await scrapeHepsiburada(page, url);
    } else if (url.includes('n11.com')) {
      platform = 'N11';
      data = await scrapeN11(page, url);
    } else {
      await page.close();
      return res.status(400).json({ error: 'Desteklenmeyen platform' });
    }
    
    await page.close();
    
    // Veriyi işle
    const result = {
      url,
      platform,
      seller: isValidSeller(data.seller) ? data.seller : null,
      price: parsePrice(data.price),
      priceText: data.price,
      title: data.title,
      rating: data.rating,
      isOfficial: data.isOfficial,
      isTrusted: isTrustedSeller(data.seller),
      success: true
    };
    
    res.json(result);
    
  } catch (error) {
    console.error('Scrape error:', error.message);
    res.status(500).json({ 
      error: error.message,
      url,
      success: false
    });
  }
});

// Çoklu URL scrape endpoint
app.post('/api/scrape-multiple', async (req, res) => {
  const { urls } = req.body;
  
  if (!urls || !Array.isArray(urls)) {
    return res.status(400).json({ error: 'URLs array gerekli' });
  }
  
  const results = [];
  const browserInstance = await getBrowser();
  
  for (const url of urls.slice(0, 20)) { // Max 20 URL
    try {
      const page = await browserInstance.newPage();
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      
      let data = null;
      let platform = null;
      
      if (url.includes('trendyol.com')) {
        platform = 'Trendyol';
        data = await scrapeTrendyol(page, url);
      } else if (url.includes('hepsiburada.com')) {
        platform = 'Hepsiburada';
        data = await scrapeHepsiburada(page, url);
      } else if (url.includes('n11.com')) {
        platform = 'N11';
        data = await scrapeN11(page, url);
      }
      
      await page.close();
      
      if (data && isValidSeller(data.seller)) {
        results.push({
          url,
          platform,
          seller: data.seller,
          price: parsePrice(data.price),
          priceText: data.price,
          title: data.title,
          rating: data.rating,
          isOfficial: data.isOfficial,
          isTrusted: isTrustedSeller(data.seller),
          success: true
        });
      }
      
    } catch (error) {
      console.error(`Error scraping ${url}:`, error.message);
    }
  }
  
  // Satıcıları grupla ve analiz et
  const sellerMap = new Map();
  
  results.forEach(r => {
    if (r.seller) {
      const key = r.seller.toLowerCase();
      if (!sellerMap.has(key)) {
        sellerMap.set(key, {
          seller: r.seller,
          platform: r.platform,
          price: r.price,
          priceText: r.priceText,
          rating: r.rating,
          isOfficial: r.isOfficial,
          isTrusted: r.isTrusted,
          products: []
        });
      }
      sellerMap.get(key).products.push({
        title: r.title,
        price: r.price,
        url: r.url
      });
    }
  });
  
  const sellers = Array.from(sellerMap.values());
  const avgPrice = results.length > 0 
    ? results.reduce((sum, r) => sum + (r.price || 0), 0) / results.filter(r => r.price).length
    : 0;
  
  res.json({
    totalScraped: urls.length,
    successfulScrapes: results.length,
    uniqueSellers: sellers.length,
    averagePrice: Math.round(avgPrice),
    sellers: sellers.map(s => ({
      ...s,
      isSuspicious: !s.isTrusted && !s.isOfficial && s.price && s.price < avgPrice * 0.7
    }))
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Ana sayfa
app.get('/', (req, res) => {
  res.json({
    name: 'Seller Scraper API',
    version: '1.0.0',
    endpoints: {
      'GET /api/scrape?url=': 'Tek URL scrape',
      'POST /api/scrape-multiple': 'Çoklu URL scrape (body: {urls: [...]})',
      'GET /health': 'Health check'
    }
  });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  if (browser) {
    await browser.close();
  }
  process.exit(0);
});

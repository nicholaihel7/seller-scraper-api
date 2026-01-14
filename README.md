# Seller Scraper API

Türk e-ticaret sitelerinden (Trendyol, Hepsiburada, N11) satıcı bilgisi çeken Puppeteer tabanlı API.

## Özellikler

- ✅ JavaScript render desteği (Puppeteer)
- ✅ Trendyol, Hepsiburada, N11 desteği
- ✅ Satıcı adı, fiyat, puan çekme
- ✅ Güvenilir satıcı tespiti
- ✅ Çoklu URL desteği

## API Endpoints

### GET /api/scrape?url=
Tek URL'den satıcı bilgisi çeker.

### POST /api/scrape-multiple
Body: `{ "urls": ["url1", "url2", ...] }`
Birden fazla URL'den satıcı bilgisi çeker (max 10).

### GET /health
Sağlık kontrolü.

## Deploy (Render.com)

1. GitHub'a push et
2. Render'da yeni Web Service oluştur
3. Build Command: `npm install`
4. Start Command: `npm start`

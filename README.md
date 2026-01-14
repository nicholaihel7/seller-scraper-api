# Seller Scraper API

Türk e-ticaret sitelerinden (Trendyol, Hepsiburada, N11) satıcı bilgisi çeken Puppeteer tabanlı API.

## Özellikler

- ✅ JavaScript render desteği (Puppeteer)
- ✅ Trendyol, Hepsiburada, N11 desteği
- ✅ Satıcı adı, fiyat, puan çekme
- ✅ Güvenilir satıcı tespiti
- ✅ Şüpheli satıcı analizi
- ✅ Çoklu URL desteği

## API Endpoints

### GET /api/scrape?url=
Tek URL'den satıcı bilgisi çeker.

**Örnek:**
```
GET /api/scrape?url=https://www.trendyol.com/apple/iphone-16-p-123456
```

**Yanıt:**
```json
{
  "url": "https://www.trendyol.com/...",
  "platform": "Trendyol",
  "seller": "MediaMarkt",
  "price": 59249,
  "priceText": "59.249 TL",
  "title": "iPhone 16 128GB",
  "rating": "4.8",
  "isOfficial": true,
  "isTrusted": true,
  "success": true
}
```

### POST /api/scrape-multiple
Birden fazla URL'den satıcı bilgisi çeker ve analiz eder.

**Body:**
```json
{
  "urls": [
    "https://www.trendyol.com/...",
    "https://www.hepsiburada.com/..."
  ]
}
```

**Yanıt:**
```json
{
  "totalScraped": 10,
  "successfulScrapes": 8,
  "uniqueSellers": 5,
  "averagePrice": 62000,
  "sellers": [
    {
      "seller": "MediaMarkt",
      "platform": "Trendyol",
      "price": 59249,
      "isTrusted": true,
      "isOfficial": true,
      "isSuspicious": false
    }
  ]
}
```

## Render'a Deploy

1. GitHub'a push et
2. Render.com'da "New Web Service" seç
3. GitHub repo'yu bağla
4. Build command: `npm install`
5. Start command: `npm start`
6. Deploy et

## Güvenilir Satıcı Listesi

- Elektronik: MediaMarkt, Vatan Bilgisayar, Teknosa, Apple Store, Samsung Store
- Kozmetik: Watsons, Gratis, Rossmann, Sephora
- Market: Migros, Carrefour, A101, BİM, ŞOK
- Marka: Nike, Adidas, Puma, Decathlon, IKEA

## Şüpheli Satıcı Kriterleri

Bir satıcı şüpheli olarak işaretlenir eğer:
- Güvenilir listesinde değilse VE
- Resmi rozeti yoksa VE
- Fiyatı ortalamanın %30'undan düşükse

## Lisans

MIT

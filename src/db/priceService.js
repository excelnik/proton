// priceService.js — שכבת מחירים לני"ע
// מקור ראשי: Yahoo Finance (ללא מפתח API, תומך TASE + US)
// fallback: ערך ידני מה-DB
// cache: SQLite עם TTL של שעה

const db = require('./index.js')

// ── אתחול טבלת cache ──────────────────────────────────────────────────────
db.prepare(`
  CREATE TABLE IF NOT EXISTS Price_Cache (
    ticker      TEXT PRIMARY KEY,
    price       REAL NOT NULL,
    currency    TEXT DEFAULT 'USD',
    change_pct  REAL,
    fetched_at  TEXT NOT NULL
  )
`).run()

const CACHE_TTL_MS = 60 * 60 * 1000 // שעה אחת

// ── fetch יחיד ──────────────────────────────────────────────────────────────
// ticker: 'AAPL' / 'TEVA.TA' / 'BTC-USD'
async function fetchPrice(ticker) {
  if (!ticker) return null

  // בדוק cache
  const cached = db.prepare('SELECT * FROM Price_Cache WHERE ticker=?').get(ticker)
  if (cached) {
    const age = Date.now() - new Date(cached.fetched_at).getTime()
    if (age < CACHE_TTL_MS) {
      return { price: cached.price, currency: cached.currency, changePct: cached.change_pct, fromCache: true }
    }
  }

  try {
    // Yahoo Finance quote endpoint (ללא CORS בסביבת Electron)
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1d`
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = await res.json()
    const meta = json?.chart?.result?.[0]?.meta
    if (!meta) throw new Error('no meta')

    const price = meta.regularMarketPrice ?? meta.previousClose
    const prevClose = meta.previousClose ?? meta.chartPreviousClose
    const currency = meta.currency ?? 'USD'
    const changePct = prevClose ? ((price - prevClose) / prevClose) * 100 : null

    // שמור cache
    db.prepare(`
      INSERT OR REPLACE INTO Price_Cache (ticker, price, currency, change_pct, fetched_at)
      VALUES (?, ?, ?, ?, datetime('now'))
    `).run(ticker, price, currency, changePct)

    return { price, currency, changePct, fromCache: false }

  } catch (err) {
    console.warn(`[priceService] fetchPrice failed for ${ticker}:`, err.message)

    // החזר cache ישן אם יש (offline fallback)
    if (cached) {
      return { price: cached.price, currency: cached.currency, changePct: cached.change_pct, fromCache: true, stale: true }
    }
    return null
  }
}

// ── fetch מרובה (assets[]) ────────────────────────────────────────────────
// מחזיר Map: ticker → { price, currency, changePct, fromCache, stale }
async function fetchPrices(tickers) {
  const unique = [...new Set(tickers.filter(Boolean))]
  const results = new Map()
  // Electron מאפשר בקשות מקביליות — מגביל ל-5 במקביל למניעת throttling
  const CHUNK = 5
  for (let i = 0; i < unique.length; i += CHUNK) {
    const chunk = unique.slice(i, i + CHUNK)
    const settled = await Promise.allSettled(chunk.map(t => fetchPrice(t)))
    chunk.forEach((t, idx) => {
      const r = settled[idx]
      if (r.status === 'fulfilled' && r.value) results.set(t, r.value)
    })
  }
  return results
}

// ── autocomplete טיקרים ──────────────────────────────────────────────────
// מחזיר מערך של { symbol, shortname, exchange, quoteType }
async function searchTicker(query) {
  if (!query || query.length < 1) return []
  try {
    const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&newsCount=0&quotesCount=8&enableFuzzyQuery=false`
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return []
    const json = await res.json()
    return (json?.quotes ?? [])
      .filter(q => q.quoteType === 'EQUITY' || q.quoteType === 'ETF' || q.quoteType === 'CRYPTOCURRENCY')
      .map(q => ({
        symbol: q.symbol,
        name: q.shortname || q.longname || q.symbol,
        exchange: q.exchange,
        type: q.quoteType,
      }))
  } catch {
    return []
  }
}

// ── המרת מטבע (ILS/USD) ──────────────────────────────────────────────────
// rate: שער ILS/USD (מ-Yahoo Finance: USDILS=X)
let _ilsRate = null
let _ilsRateFetched = 0

async function getUsdToIls() {
  if (_ilsRate && Date.now() - _ilsRateFetched < CACHE_TTL_MS) return _ilsRate
  try {
    const r = await fetchPrice('USDILS=X')
    if (r?.price) { _ilsRate = r.price; _ilsRateFetched = Date.now() }
  } catch {}
  return _ilsRate ?? 3.7 // fallback
}

// המרה: price (במטבע המקור) → ILS
async function toIls(price, currency) {
  if (!price) return 0
  if (currency === 'ILS' || currency === 'ILA') return currency === 'ILA' ? price / 100 : price
  if (currency === 'USD' || !currency) {
    const rate = await getUsdToIls()
    return price * rate
  }
  // מטבעות אחרים — ניתן להרחיב
  return price
}

module.exports = { fetchPrice, fetchPrices, searchTicker, toIls, getUsdToIls }

// NetWorth.jsx — ניהול שווי נקי | Proton v2
const React = require('react')
const { useState, useEffect, useMemo, useRef, useCallback } = React
const db = require('../db/index.js')
const { fetchPrices, searchTicker, getUsdToIls } = require('../db/priceService.js')

// ─── מיגרציה guard (בטוח לריצה חוזרת) ──────────────────────────────────
;(function migrate() {
  const cols = db.prepare('PRAGMA table_info(Assets)').all().map(c => c.name)
  const add = (col, def) => { if (!cols.includes(col)) try { db.prepare(`ALTER TABLE Assets ADD COLUMN ${col} ${def}`).run() } catch {} }
  add('exchange',         'TEXT')
  add('last_api_price',   'REAL')
  add('price_currency',   "TEXT DEFAULT 'ILS'")
  add('price_override',   'REAL')
  add('price_updated_at', 'TEXT')
  add('purchase_price',   'REAL')
  add('purchase_date',    'TEXT')
})()

// ─── חישובי עזר ──────────────────────────────────────────────────────────
function getAccountBalance(acc) {
  const s = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN transaction_type='Income'  THEN amount ELSE 0 END),0) as inc,
      COALESCE(SUM(CASE WHEN transaction_type='Expense' THEN amount ELSE 0 END),0) as exp
    FROM Transactions WHERE account_id=?
  `).get(acc.id)
  return acc.opening_balance + s.inc - s.exp
}

function getLoanBalance(loan) {
  if (!loan.first_payment_date) return loan.total_amount
  const monthlyRate = loan.interest_rate / 100 / 12
  const activeDuration = loan.duration_months - (loan.grace_period_months || 0)
  const pmt = monthlyRate === 0
    ? loan.total_amount / activeDuration
    : (loan.total_amount * monthlyRate * Math.pow(1 + monthlyRate, activeDuration)) /
      (Math.pow(1 + monthlyRate, activeDuration) - 1)
  const start = new Date(loan.first_payment_date)
  const today = new Date()
  const monthsPassed = Math.max(0, Math.min(
    (today.getFullYear() - start.getFullYear()) * 12 + (today.getMonth() - start.getMonth()),
    loan.duration_months
  ))
  let balance = loan.total_amount
  for (let i = 0; i < monthsPassed; i++) {
    if (i >= (loan.grace_period_months || 0)) {
      const interest = balance * monthlyRate
      balance = Math.max(0, balance - (pmt - interest))
    }
  }
  return balance
}

function getAssetValueIls(asset, priceMap, usdRate) {
  if (asset.price_override != null) return asset.price_override * (asset.quantity || 1)
  if (asset.ticker_symbol && priceMap.has(asset.ticker_symbol)) {
    const p = priceMap.get(asset.ticker_symbol)
    const priceIls = (p.currency === 'ILA') ? p.price / 100
      : (p.currency === 'ILS') ? p.price
      : p.price * (usdRate ?? 3.7)
    return priceIls * (asset.quantity || 1)
  }
  return (asset.current_value || 0) * (asset.quantity || 1)
}

function getUnitPriceIls(asset, priceMap, usdRate) {
  if (asset.price_override != null) return asset.price_override
  if (asset.ticker_symbol && priceMap.has(asset.ticker_symbol)) {
    const p = priceMap.get(asset.ticker_symbol)
    return (p.currency === 'ILA') ? p.price / 100
      : (p.currency === 'ILS') ? p.price
      : p.price * (usdRate ?? 3.7)
  }
  return asset.current_value || 0
}

function getEmergencyData() {
  try {
    const row = db.prepare(
      "SELECT cleaned_name FROM Automation_Rules WHERE original_string='emergency_months' AND match_type='setting'"
    ).get()
    const months = parseInt(row?.cleaned_name || '3')
    const sixMonthsAgo = new Date()
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6)
    const from = sixMonthsAgo.toISOString().slice(0, 10)
    const totalExpenses = db.prepare(`
      SELECT COALESCE(SUM(amount),0) as v FROM Transactions
      WHERE transaction_type='Expense' AND is_budgetary=1 AND transaction_date >= ?
    `).get(from).v
    const avgMonthly = totalExpenses / 6
    const target = avgMonthly * months
    const emergencyAsset = db.prepare(`
      SELECT SUM(current_value * COALESCE(quantity,1)) as v FROM Assets
      WHERE is_active=1 AND (name LIKE '%קרן חירום%' OR name LIKE '%emergency%')
    `).get()
    const liquid = emergencyAsset?.v || 0
    return { avgMonthly, target, liquid, missing: Math.max(0, target - liquid), months }
  } catch { return { avgMonthly: 0, target: 0, liquid: 0, missing: 0, months: 3 } }
}

function getNetWorthHistory(range) {
  try {
    const limitMap = { '3M': 3, '6M': 6, '1Y': 12, 'הכל': 60 }
    const limit = limitMap[range] || 12
    return db.prepare(`
      SELECT strftime('%Y-%m', snapshot_date) as ym, AVG(net_worth) as nw
      FROM Net_Worth_Snapshots GROUP BY ym ORDER BY ym DESC LIMIT ?
    `).all(limit).reverse()
  } catch { return [] }
}

const fmt   = n => '₪' + Math.abs(Math.round(n)).toLocaleString('he-IL')
const fmtPct = n => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`

const ASSET_TYPE_META = {
  RealEstate: { label: 'נדל"ן',       color: '#10B981', icon: '🏠' },
  Stock:      { label: 'תיק השקעות',  color: '#6366F1', icon: '📈' },
  Investment: { label: 'ני"ע / קרנות', color: '#8B5CF6', icon: '📊' },
  Savings:    { label: 'פיקדון',       color: '#0EA5E9', icon: '🏦' },
  Crypto:     { label: 'קריפטו',       color: '#F59E0B', icon: '₿'  },
  Cash:       { label: 'מזומן',        color: '#94A3B8', icon: '💵' },
  Other:      { label: 'אחר',          color: '#CBD5E1', icon: '📦' },
}

// ─── רכיב ראשי ────────────────────────────────────────────────────────────
function NetWorth() {
  const [accounts, setAccounts]           = useState([])
  const [loans, setLoans]                 = useState([])
  const [assets, setAssets]               = useState([])
  const [informalDebts, setInformalDebts] = useState([])
  const [priceMap, setPriceMap]           = useState(new Map())
  const [usdRate, setUsdRate]             = useState(3.7)
  const [loadingPrices, setLoadingPrices] = useState(false)
  const [priceStale, setPriceStale]       = useState(false)
  const [showAssetModal, setShowAssetModal]   = useState(false)
  const [showDebtModal, setShowDebtModal]     = useState(false)
  const [editAsset, setEditAsset]         = useState(null)
  const [editDebt, setEditDebt]           = useState(null)
  const [chartRange, setChartRange]       = useState('1Y')
  const [showAddStock, setShowAddStock]   = useState(false)
  const [snapshotVersion, setSnapshotVersion] = useState(0)
  const [snapshotSaved, setSnapshotSaved]     = useState(false)

  // קיצורי מקלדת
  useEffect(() => {
    const handler = e => {
      if (e.ctrlKey && e.shiftKey && (e.key === 'N' || e.key === 'מ')) { e.preventDefault(); setShowDebtModal(true) }
      else if (e.ctrlKey && (e.key === 'n' || e.key === 'מ')) { e.preventDefault(); setShowAssetModal(true) }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  function loadData() {
    setAccounts(db.prepare('SELECT * FROM Accounts WHERE is_active=1').all())
    setLoans(db.prepare('SELECT * FROM Liabilities WHERE is_active=1').all())
    setAssets(db.prepare('SELECT * FROM Assets WHERE is_active=1 ORDER BY type, name').all())
    setInformalDebts(db.prepare('SELECT * FROM Informal_Debts WHERE is_active=1').all())
  }

  useEffect(() => { loadData() }, [])

  const refreshPrices = useCallback(async () => {
    const tickers = assets.map(a => a.ticker_symbol).filter(Boolean)
    if (!tickers.length) return
    setLoadingPrices(true)
    setPriceStale(false)
    try {
      const map = await fetchPrices(tickers)
      setPriceMap(map)
      const rate = await getUsdToIls()
      setUsdRate(rate)
      const stmt = db.prepare("UPDATE Assets SET last_api_price=?, price_currency=?, price_updated_at=datetime('now') WHERE ticker_symbol=?")
      for (const [ticker, data] of map.entries()) stmt.run(data.price, data.currency, ticker)
      if ([...map.values()].some(v => v.stale)) setPriceStale(true)
    } catch { setPriceStale(true) }
    finally { setLoadingPrices(false) }
  }, [assets])

  useEffect(() => { if (assets.length) refreshPrices() }, [assets.length])

  // ── חישובים ──────────────────────────────────────────────────────────────
  const calculated = useMemo(() => {
    const bankAccounts = accounts.filter(a => a.type === 'Bank' || a.type === 'Cash')
    const creditCards  = accounts.filter(a => a.type === 'Credit_Card')
    const bankTotal      = bankAccounts.reduce((s, a) => s + Math.max(0, getAccountBalance(a)), 0)
    const overdraftTotal = bankAccounts.reduce((s, a) => { const b = getAccountBalance(a); return s + (b < 0 ? Math.abs(b) : 0) }, 0)
    const assetsTotal    = assets.reduce((s, a) => s + getAssetValueIls(a, priceMap, usdRate), 0)
    const totalAssets    = bankTotal + assetsTotal
    const loansTotal     = loans.reduce((s, l) => s + getLoanBalance(l), 0)
    const creditTotal    = creditCards.reduce((s, a) => { const b = getAccountBalance(a); return s + (b < 0 ? Math.abs(b) : 0) }, 0)
    const informalTotal  = informalDebts.filter(d => d.direction === 'borrowed').reduce((s, d) => s + d.amount, 0)
    const totalLiabilities = loansTotal + creditTotal + informalTotal + overdraftTotal
    return { bankTotal, assetsTotal, totalAssets, loansTotal, creditTotal, informalTotal, overdraftTotal, totalLiabilities, netWorth: totalAssets - totalLiabilities }
  }, [accounts, loans, assets, informalDebts, priceMap, usdRate])

  const emergency = useMemo(() => getEmergencyData(), [assets, accounts])
  const chartData = useMemo(() => getNetWorthHistory(chartRange), [chartRange, snapshotVersion])

  // עוגה
  const pieData = useMemo(() => {
    const groups = {}
    accounts.filter(a => a.type === 'Bank' || a.type === 'Cash').forEach(a => {
      const bal = Math.max(0, getAccountBalance(a))
      if (bal > 0) groups['Cash'] = (groups['Cash'] || 0) + bal
    })
    assets.forEach(a => {
      const val = getAssetValueIls(a, priceMap, usdRate)
      const type = a.type || 'Other'
      groups[type] = (groups[type] || 0) + val
    })
    const total = Object.values(groups).reduce((s, v) => s + v, 0)
    return Object.entries(groups).filter(([, v]) => v > 0).sort(([, a], [, b]) => b - a).map(([type, value]) => ({
      type, value,
      pct: total > 0 ? Math.round((value / total) * 100) : 0,
      ...ASSET_TYPE_META[type] || ASSET_TYPE_META.Other,
    }))
  }, [accounts, assets, priceMap, usdRate])

  function getMonthlyChange() {
    try {
      const lm = new Date(); lm.setMonth(lm.getMonth() - 1)
      const ym = lm.toISOString().slice(0, 7)
      const snap = db.prepare("SELECT net_worth FROM Net_Worth_Snapshots WHERE strftime('%Y-%m',snapshot_date)=? ORDER BY snapshot_date DESC LIMIT 1").get(ym)
      if (!snap) return null
      const diff = calculated.netWorth - snap.net_worth
      const pct  = snap.net_worth ? (diff / snap.net_worth) * 100 : 0
      return { diff, pct }
    } catch { return null }
  }

  const monthlyChange = useMemo(() => getMonthlyChange(), [calculated.netWorth])

  function saveSnapshot() {
    let saved = false
    try {
      db.prepare(`
        INSERT INTO Net_Worth_Snapshots (snapshot_date, total_assets, total_liabilities, net_worth)
        VALUES (date('now'), ?, ?, ?)
        ON CONFLICT DO UPDATE SET total_assets=excluded.total_assets,
          total_liabilities=excluded.total_liabilities, net_worth=excluded.net_worth
      `).run(calculated.totalAssets, calculated.totalLiabilities, calculated.netWorth)
      saved = true
    } catch {
      try {
        db.prepare(`INSERT OR REPLACE INTO Net_Worth_Snapshots (snapshot_date, total_assets, total_liabilities, net_worth) VALUES (date('now'), ?, ?, ?)`)
          .run(calculated.totalAssets, calculated.totalLiabilities, calculated.netWorth)
        saved = true
      } catch (e) { console.error('snapshot failed', e) }
    }
    if (saved) {
      setSnapshotVersion(v => v + 1)
      setSnapshotSaved(true)
      setTimeout(() => setSnapshotSaved(false), 2500)
      loadData()
    }
  }

  return React.createElement('div', { style: S.page },

    // ── Header ──────────────────────────────────────────────────────────
    React.createElement('div', { style: S.header },
      React.createElement('h1', { style: S.title }, 'ניהול שווי נקי'),
      React.createElement('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
        loadingPrices && React.createElement('span', { style: S.badgeBlue }, '⟳ מעדכן מחירים...'),
        priceStale && !loadingPrices && React.createElement('span', { style: S.badgeAmber }, '⚠ מחירים חלקיים'),
        React.createElement('button', { style: S.btnSecondary, onClick: refreshPrices, disabled: loadingPrices }, '↻ מחירים'),
        React.createElement('button', { style: S.btnSecondary, onClick: () => { setEditDebt(null); setShowDebtModal(true) } }, '+ חוב זמני'),
        React.createElement('button', { style: S.btnPrimary, onClick: () => { setEditAsset(null); setShowAssetModal(true) } }, '+ נכס'),
      ),
    ),

    // ── KPI Bar ─────────────────────────────────────────────────────────
    React.createElement('div', { style: S.kpiBar },
      React.createElement('div', { style: S.kpiItem },
        React.createElement('div', { style: S.kpiLabel }, 'שווי נקי'),
        React.createElement('div', { style: { ...S.kpiValue, color: calculated.netWorth >= 0 ? '#10B981' : '#E11D48' } }, fmt(calculated.netWorth)),
        monthlyChange && React.createElement('div', { style: { fontSize: 11, color: monthlyChange.diff >= 0 ? '#10B981' : '#E11D48', marginTop: 2 } },
          `${monthlyChange.diff >= 0 ? '↑' : '↓'} ${fmt(Math.abs(monthlyChange.diff))} (${fmtPct(monthlyChange.pct)}) מחודש שעבר`
        ),
      ),
      React.createElement('div', { style: S.kpiDivider }),
      React.createElement('div', { style: S.kpiItem },
        React.createElement('div', { style: S.kpiLabel }, 'סך נכסים'),
        React.createElement('div', { style: { ...S.kpiValue, color: '#10B981' } }, fmt(calculated.totalAssets)),
      ),
      React.createElement('div', { style: S.kpiDivider }),
      React.createElement('div', { style: S.kpiItem },
        React.createElement('div', { style: S.kpiLabel }, 'סך התחייבויות'),
        React.createElement('div', { style: { ...S.kpiValue, color: '#E11D48' } }, fmt(calculated.totalLiabilities)),
      ),
      React.createElement('div', { style: S.kpiDivider }),
      React.createElement('div', { style: { ...S.kpiItem, display: 'flex', flexDirection: 'column', alignItems: 'center' } },
        React.createElement('button', {
          style: {
            ...S.btnPrimary, fontSize: 12, padding: '6px 14px',
            ...(snapshotSaved ? { background: '#10B981', cursor: 'default' } : {}),
            transition: 'background 0.3s',
          },
          onClick: snapshotSaved ? undefined : saveSnapshot,
          disabled: snapshotSaved,
          title: 'שמור snapshot של היום לגרף המגמה',
        }, snapshotSaved ? '✓ נשמר!' : '📸 שמור snapshot'),
      ),
    ),

    // ── גוף — שתי עמודות ────────────────────────────────────────────────
    React.createElement('div', { style: S.mainGrid },

      // עמודה שמאלית: גרף + עוגה + קרן חירום
      React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 16 } },

        // גרף מגמה
        React.createElement('div', { style: S.card },
          React.createElement('div', { style: S.cardHeader },
            React.createElement('span', { style: S.cardTitle }, 'גרף מגמה — שווי נקי'),
            React.createElement('div', { style: { display: 'flex', gap: 4 } },
              ['3M', '6M', '1Y', 'הכל'].map(r =>
                React.createElement('button', { key: r, style: { ...S.rangeBtn, ...(chartRange === r ? S.rangeBtnActive : {}) }, onClick: () => setChartRange(r) }, r)
              )
            ),
          ),
          React.createElement(MiniChart, { data: chartData }),
        ),

        // עוגת התפלגות
        React.createElement('div', { style: S.card },
          React.createElement('div', { style: S.cardHeader },
            React.createElement('span', { style: S.cardTitle }, 'התפלגות נכסים'),
          ),
          React.createElement(PieChart, { data: pieData }),
        ),

        // קרן חירום
        React.createElement(EmergencyWidget, { data: emergency }),
      ),

      // עמודה ימנית: נכסים + התחייבויות
      React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 16 } },

        // נכסים
        React.createElement('div', { style: { ...S.card, display: 'flex', flexDirection: 'column' } },
          React.createElement('div', { style: { ...S.sectionBanner, background: '#10B981' } },
            React.createElement('span', null, 'נכסים'),
            React.createElement('span', null, fmt(calculated.totalAssets)),
          ),
          React.createElement('div', { style: { overflowY: 'auto', maxHeight: 480, paddingBottom: 4 } },

          // עו"ש אוטומטי
          accounts.filter(a => (a.type === 'Bank' || a.type === 'Cash') && getAccountBalance(a) > 0).length > 0 &&
          React.createElement(AssetGroup, {
            icon: '🏦', title: 'חשבון עו"ש',
            items: accounts.filter(a => (a.type === 'Bank' || a.type === 'Cash') && getAccountBalance(a) > 0).map(acc => ({
              name: acc.name, value: getAccountBalance(acc), badge: 'auto',
            })),
          }),

          // תיק השקעות / מניות — קיבוץ מיוחד עם inline add
          React.createElement(StockPortfolioGroup, {
            assets: assets.filter(a => a.type === 'Stock' || a.type === 'Investment'),
            priceMap, usdRate,
            onEdit: a => { setEditAsset(a); setShowAssetModal(true) },
            onDelete: a => { db.prepare('UPDATE Assets SET is_active=0 WHERE id=?').run(a.id); loadData() },
            onSaved: loadData,
          }),

          // שאר סוגי הנכסים (לא מניות/תיק)
          Object.entries(
            assets.filter(a => a.type !== 'Stock' && a.type !== 'Investment').reduce((acc, a) => {
              const k = a.type || 'Other'; if (!acc[k]) acc[k] = []; acc[k].push(a); return acc
            }, {})
          ).map(([type, typeAssets]) =>
            React.createElement(AssetGroup, {
              key: type,
              icon: ASSET_TYPE_META[type]?.icon || '📦',
              title: ASSET_TYPE_META[type]?.label || type,
              items: typeAssets.map(a => ({
                name: a.name,
                value: getAssetValueIls(a, priceMap, usdRate),
                badge: a.price_override != null ? 'override' : (priceMap.has(a.ticker_symbol) ? 'api' : 'manual'),
                onEdit: () => { setEditAsset(a); setShowAssetModal(true) },
                onDelete: () => { db.prepare('UPDATE Assets SET is_active=0 WHERE id=?').run(a.id); loadData() },
              })),
            })
          ),

          // הלוואות שנתתי (נכס)
          informalDebts.filter(d => d.direction === 'lent').length > 0 &&
          React.createElement(AssetGroup, {
            icon: '🤝', title: 'הלוואות שנתתי',
            items: informalDebts.filter(d => d.direction === 'lent').map(d => ({
              name: d.name, value: d.amount,
              sub: d.due_date ? `פירעון: ${d.due_date}` : 'ללא פירעון',
              badge: 'lent',
              onEdit: () => { setEditDebt(d); setShowDebtModal(true) },
              onDelete: () => { db.prepare('UPDATE Informal_Debts SET is_active=0 WHERE id=?').run(d.id); loadData() },
            })),
          }),

          ), // סוף אזור גלילה נכסים
          React.createElement('button', { style: { ...S.btnSecondary, width: '100%', marginTop: 8, fontSize: 12 }, onClick: () => { setEditAsset(null); setShowAssetModal(true) } }, '+ הוסף נכס'),
        ),

        // התחייבויות
        React.createElement('div', { style: { ...S.card, display: 'flex', flexDirection: 'column' } },
          React.createElement('div', { style: { ...S.sectionBanner, background: '#E11D48' } },
            React.createElement('span', null, 'התחייבויות'),
            React.createElement('span', null, fmt(calculated.totalLiabilities)),
          ),
          React.createElement('div', { style: { overflowY: 'auto', maxHeight: 480, paddingBottom: 4 } },

          loans.length > 0 && React.createElement(LiabilityGroup, {
            icon: '🏦', title: 'הלוואות',
            items: loans.map(l => ({
              name: l.name, value: getLoanBalance(l),
              sub: l.first_payment_date ? `פירעון: ${new Date(l.first_payment_date).toLocaleDateString('he-IL', { year: 'numeric', month: '2-digit' })}` : 'ללא תאריך',
              badge: l.first_payment_date ? 'loan' : 'open',
            })),
          }),

          calculated.creditTotal > 0 && React.createElement(LiabilityGroup, {
            icon: '💳', title: 'כרטיסי אשראי',
            items: accounts.filter(a => a.type === 'Credit_Card' && getAccountBalance(a) < 0).map(acc => ({
              name: acc.name, value: Math.abs(getAccountBalance(acc)), badge: 'credit',
            })),
          }),

          calculated.overdraftTotal > 0 && React.createElement(LiabilityGroup, {
            icon: '🔴', title: 'אוברדראפט',
            items: accounts.filter(a => (a.type === 'Bank' || a.type === 'Cash') && getAccountBalance(a) < 0).map(acc => ({
              name: acc.name, value: Math.abs(getAccountBalance(acc)), badge: 'overdraft',
            })),
          }),

          informalDebts.filter(d => d.direction === 'borrowed').length > 0 && React.createElement(LiabilityGroup, {
            icon: '🤝', title: 'חובות זמניים',
            items: informalDebts.filter(d => d.direction === 'borrowed').map(d => ({
              name: d.name, value: d.amount,
              sub: d.due_date ? `עד ${d.due_date}` : 'ללא פירעון',
              badge: d.due_date ? 'loan' : 'open',
              onEdit: () => { setEditDebt(d); setShowDebtModal(true) },
              onDelete: () => { db.prepare('UPDATE Informal_Debts SET is_active=0 WHERE id=?').run(d.id); loadData() },
            })),
          }),

          ), // סוף אזור גלילה התחייבויות
          React.createElement('button', { style: { ...S.btnSecondary, width: '100%', marginTop: 8, fontSize: 12 }, onClick: () => { setEditDebt(null); setShowDebtModal(true) } }, '+ הוסף חוב זמני'),
        ),
      ),
    ),

    // מודאלים
    showAssetModal && React.createElement(AssetModal, {
      editAsset, usdRate,
      onClose: () => { setShowAssetModal(false); setEditAsset(null) },
      onSave:  () => { setShowAssetModal(false); setEditAsset(null); loadData() },
    }),
    showDebtModal && React.createElement(InformalDebtModal, {
      editDebt,
      onClose: () => { setShowDebtModal(false); setEditDebt(null) },
      onSave:  () => { setShowDebtModal(false); setEditDebt(null); loadData() },
    }),
  )
}

// ─── תיק השקעות — קיבוץ מיוחד עם inline add row ──────────────────────────
function StockPortfolioGroup({ assets, priceMap, usdRate, onEdit, onDelete, onSaved }) {
  const [open, setOpen]           = useState(true)
  const [showAddRow, setShowAddRow] = useState(false)
  const total = assets.reduce((s, a) => s + getAssetValueIls(a, priceMap, usdRate), 0)

  if (assets.length === 0 && !showAddRow) {
    return React.createElement('div', { style: { marginBottom: 12 } },
      React.createElement('div', { style: S.groupHeader, onClick: () => setShowAddRow(true) },
        React.createElement('span', { style: { fontSize: 13 } }, '📈 תיק השקעות'),
        React.createElement('span', { style: { fontSize: 12, color: '#6366F1' } }, '+ הוסף ני"ע ראשון'),
      ),
    )
  }

  return React.createElement('div', { style: { marginBottom: 12 } },
    // header
    React.createElement('div', { style: S.groupHeader, onClick: () => setOpen(o => !o) },
      React.createElement('span', { style: { fontSize: 13 } }, '📈 תיק השקעות'),
      React.createElement('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
        React.createElement('span', { style: { fontSize: 13, fontWeight: 700, color: '#6366F1' } }, fmt(total)),
        React.createElement('span', { style: { fontSize: 11, color: '#94A3B8' } }, open ? '▲' : '▼'),
      ),
    ),

    open && React.createElement('div', null,
      // כותרת עמודות
      assets.length > 0 && React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr 80px 70px 80px 70px 48px', gap: 4, padding: '4px 10px', borderBottom: '1px solid #E2E8F0' } },
        React.createElement('span', { style: S.colHeader }, 'שם / טיקר'),
        React.createElement('span', { style: { ...S.colHeader, textAlign: 'right' } }, 'כמות'),
        React.createElement('span', { style: { ...S.colHeader, textAlign: 'right' } }, 'מחיר קנייה'),
        React.createElement('span', { style: { ...S.colHeader, textAlign: 'right' } }, 'שווי נוכחי'),
        React.createElement('span', { style: { ...S.colHeader, textAlign: 'right' } }, 'רווח/הפסד'),
        React.createElement('span', null),
      ),

      // שורות
      assets.map(a => React.createElement(StockRow, {
        key: a.id, asset: a, priceMap, usdRate, onEdit, onDelete,
      })),

      // שורת הוספה inline
      showAddRow && React.createElement(AddStockRow, {
        onSaved: () => { setShowAddRow(false); onSaved() },
        onCancel: () => setShowAddRow(false),
        usdRate,
      }),

      // כפתור הוסף
      !showAddRow && React.createElement('button', {
        style: { ...S.btnSecondary, width: '100%', marginTop: 6, fontSize: 12, color: '#6366F1', border: '1px solid #C7D2FE' },
        onClick: e => { e.stopPropagation(); setShowAddRow(true) },
      }, '+ הוסף ני"ע חדש'),
    ),
  )
}

// ─── שורת ני"ע בודד ──────────────────────────────────────────────────────
function StockRow({ asset, priceMap, usdRate, onEdit, onDelete }) {
  const apiData       = asset.ticker_symbol ? priceMap.get(asset.ticker_symbol) : null
  const currency      = apiData?.currency ?? asset.price_currency ?? 'ILS'
  const qty           = asset.quantity || 1

  // מחיר נוכחי במטבע המקורי (ללא המרה)
  const currentPriceOrig = apiData
    ? (currency === 'ILA' ? apiData.price / 100 : apiData.price)
    : (asset.last_api_price ?? asset.current_value ?? 0)

  // שווי נוכחי בשקלים (להצגה)
  const currentTotalIls = getAssetValueIls(asset, priceMap, usdRate)

  // רווח/הפסד — חישוב במטבע מקורי, המרה לשקלים בסוף
  let gainPct = null, gainIls = null
  if (asset.purchase_price != null && currentPriceOrig) {
    const gainOrig   = (currentPriceOrig - asset.purchase_price) * qty
    gainPct          = ((currentPriceOrig - asset.purchase_price) / asset.purchase_price) * 100
    const toIlsFactor = (currency === 'ILS' || currency === 'ILA') ? 1 : (usdRate ?? 3.7)
    gainIls          = gainOrig * toIlsFactor
  }

  // תצוגת מחיר קנייה עם הסימון הנכון
  const currencySymbol = (currency === 'ILS' || currency === 'ILA') ? '₪' : (currency === 'USD' ? '$' : currency)
  const purchaseDisplay = asset.purchase_price != null
    ? `${currencySymbol}${asset.purchase_price.toLocaleString('he-IL', { maximumFractionDigits: 2 })}`
    : '—'

  const gainColor = gainIls == null ? '#94A3B8' : gainIls >= 0 ? '#10B981' : '#E11D48'

  return React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr 60px 72px 84px 84px 44px', gap: 4, padding: '7px 10px', borderBottom: '1px solid #F1F5F9', alignItems: 'center' } },
    // שם + טיקר + שינוי יומי
    React.createElement('div', null,
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 5 } },
        React.createElement('span', { style: { fontSize: 13, fontWeight: 500, color: '#334155' } }, asset.name),
        asset.ticker_symbol && React.createElement('span', { style: S.tickerBadge }, asset.ticker_symbol),
      ),
      asset.purchase_date && React.createElement('div', { style: { fontSize: 10, color: '#94A3B8' } }, `נרכש: ${asset.purchase_date}`),
      apiData?.changePct != null && React.createElement('div', { style: { fontSize: 10, color: apiData.changePct >= 0 ? '#10B981' : '#E11D48' } },
        `${fmtPct(apiData.changePct)} היום`
      ),
    ),
    // כמות
    React.createElement('div', { style: { fontSize: 13, textAlign: 'right', color: '#475569' } }, qty),
    // מחיר קנייה (במטבע מקורי)
    React.createElement('div', { style: { fontSize: 11, textAlign: 'right', color: '#94A3B8' } }, purchaseDisplay),
    // שווי נוכחי בשקלים
    React.createElement('div', { style: { fontSize: 13, fontWeight: 700, textAlign: 'right', color: '#0F172A' } }, fmt(currentTotalIls)),
    // רווח/הפסד
    React.createElement('div', { style: { fontSize: 11, textAlign: 'right', color: gainColor } },
      gainIls == null ? '—' :
        React.createElement('div', null,
          React.createElement('div', { style: { fontWeight: 600 } }, `${gainIls >= 0 ? '+' : ''}${fmt(gainIls)}`),
          React.createElement('div', null, fmtPct(gainPct)),
        )
    ),
    // פעולות
    React.createElement('div', { style: { display: 'flex', gap: 2 } },
      React.createElement('button', { style: S.actionBtn, onClick: () => onEdit(asset), title: 'ערוך' }, '✏️'),
      React.createElement('button', { style: S.actionBtn, onClick: () => onDelete(asset), title: 'מחק' }, '🗑'),
    ),
  )
}

// ─── שורת הוספת ני"ע inline ──────────────────────────────────────────────
function AddStockRow({ onSaved, onCancel, usdRate }) {
  const [form, setForm]     = useState({ name: '', ticker: '', quantity: '1', purchase_price: '', purchase_date: '' })
  const [suggestions, setSuggestions] = useState([])
  const [livePrice, setLivePrice]     = useState(null)
  const [loading, setLoading]         = useState(false)
  const debounceRef = useRef(null)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleTickerInput = useCallback((val) => {
    set('ticker', val)
    setLivePrice(null)
    clearTimeout(debounceRef.current)
    if (!val) { setSuggestions([]); return }
    debounceRef.current = setTimeout(async () => {
      const res = await searchTicker(val)
      setSuggestions(res.slice(0, 5))
    }, 350)
  }, [])

  const selectSuggestion = useCallback(async (s) => {
    set('ticker', s.symbol)
    if (!form.name) set('name', s.name)
    setSuggestions([])
    setLoading(true)
    try {
      const { fetchPrice } = require('../db/priceService.js')
      const p = await fetchPrice(s.symbol)
      if (p) {
        const priceIls = p.currency === 'ILA' ? p.price / 100 : p.currency === 'ILS' ? p.price : p.price * (usdRate ?? 3.7)
        setLivePrice({ ...p, priceIls })
      }
    } catch {}
    setLoading(false)
  }, [form.name, usdRate])

  function handleSave() {
    if (!form.name && !form.ticker) return
    db.prepare(`
      INSERT INTO Assets (name, type, current_value, quantity, ticker_symbol, exchange, purchase_price, purchase_date, is_active)
      VALUES (?, 'Stock', ?, ?, ?, ?, ?, ?, 1)
    `).run(
      form.name || form.ticker,
      livePrice?.priceIls || 0,
      parseFloat(form.quantity) || 1,
      form.ticker || null,
      null,
      parseFloat(form.purchase_price) || null,
      form.purchase_date || null,
    )
    onSaved()
  }

  return React.createElement('div', { style: { background: '#F8FAFC', borderRadius: 8, padding: '10px 10px', margin: '4px 0', border: '1px dashed #C7D2FE' } },
    React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '1.5fr 1fr 90px 90px 90px auto', gap: 6, alignItems: 'start' } },

      // טיקר + autocomplete
      React.createElement('div', { style: { position: 'relative' } },
        React.createElement('input', {
          style: { ...S.inputSm, width: '100%' },
          placeholder: 'טיקר (AAPL, TEVA.TA...)',
          value: form.ticker,
          onChange: e => handleTickerInput(e.target.value),
          autoFocus: true,
        }),
        suggestions.length > 0 && React.createElement('div', { style: S.dropdown },
          suggestions.map((s, i) =>
            React.createElement('div', { key: i, style: S.dropdownItem, onClick: () => selectSuggestion(s) },
              React.createElement('span', { style: { fontWeight: 600, fontSize: 12 } }, s.symbol),
              React.createElement('span', { style: { fontSize: 11, color: '#64748B', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: 6 } }, s.name),
              React.createElement('span', { style: { fontSize: 10, color: '#94A3B8' } }, s.exchange),
            )
          )
        ),
        livePrice && React.createElement('div', { style: { fontSize: 10, color: '#065F46', marginTop: 2 } },
          `${fmt(livePrice.priceIls)} ליח׳ ${livePrice.changePct != null ? `(${fmtPct(livePrice.changePct)} היום)` : ''}`
        ),
      ),

      // שם
      React.createElement('input', { style: { ...S.inputSm, width: '100%' }, placeholder: 'שם', value: form.name, onChange: e => set('name', e.target.value) }),

      // כמות
      React.createElement('input', { style: { ...S.inputSm, width: '100%' }, type: 'number', placeholder: 'כמות', value: form.quantity, onChange: e => set('quantity', e.target.value) }),

      // מחיר קנייה — placeholder לפי מטבע הטיקר
      React.createElement('input', { style: { ...S.inputSm, width: '100%' }, type: 'number',
        placeholder: livePrice ? `מחיר קנייה ${livePrice.currency === 'ILS' || livePrice.currency === 'ILA' ? '₪' : '$'}` : 'מחיר קנייה',
        value: form.purchase_price, onChange: e => set('purchase_price', e.target.value) }),

      // תאריך קנייה
      React.createElement('input', { style: { ...S.inputSm, width: '100%' }, type: 'date', value: form.purchase_date, onChange: e => set('purchase_date', e.target.value) }),

      // כפתורים
      React.createElement('div', { style: { display: 'flex', gap: 4 } },
        React.createElement('button', { style: { ...S.btnPrimary, fontSize: 11, padding: '5px 10px' }, onClick: handleSave }, '✓'),
        React.createElement('button', { style: { ...S.btnSecondary, fontSize: 11, padding: '5px 8px' }, onClick: onCancel }, '✕'),
      ),
    ),
  )
}

// ─── ווידג'ט קרן חירום ───────────────────────────────────────────────────
function EmergencyWidget({ data }) {
  const { avgMonthly, target, liquid, missing, months } = data
  const pct = target > 0 ? Math.min(100, Math.round((liquid / target) * 100)) : 0
  const ok  = missing === 0

  return React.createElement('div', { style: { ...S.card, border: ok ? '1px solid #BBF7D0' : '1px solid #FDE68A' } },
    React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 } },
      React.createElement('div', null,
        React.createElement('div', { style: { fontSize: 13, fontWeight: 600, color: '#0F172A', marginBottom: 2 } }, '🛡️ קרן חירום'),
        React.createElement('div', { style: { fontSize: 11, color: '#64748B' } },
          `יעד: ${fmt(target)} (${fmt(avgMonthly)} × ${months} חודשים)`
        ),
      ),
      ok
        ? React.createElement('span', { style: S.badgeGreen }, '✓ מוגן!')
        : React.createElement('span', { style: S.badgeAmber }, `חסר ${fmt(missing)}`),
    ),
    React.createElement('div', { style: { height: 8, background: '#E2E8F0', borderRadius: 4, overflow: 'hidden', marginBottom: 6 } },
      React.createElement('div', { style: { height: '100%', borderRadius: 4, width: `${pct}%`, background: ok ? '#10B981' : '#F59E0B', transition: 'width 0.4s' } })
    ),
    React.createElement('div', { style: { fontSize: 11, color: '#64748B' } },
      `נזיל: ${fmt(liquid)} מתוך ${fmt(target)} (${pct}%)`
    ),
  )
}

// ─── AssetGroup (נכסים רגילים) ────────────────────────────────────────────
function AssetGroup({ icon, title, items }) {
  const [open, setOpen] = useState(true)
  const total = items.reduce((s, i) => s + (i.value || 0), 0)
  return React.createElement('div', { style: { marginBottom: 12 } },
    React.createElement('div', { style: S.groupHeader, onClick: () => setOpen(o => !o) },
      React.createElement('span', { style: { fontSize: 13 } }, `${icon} ${title}`),
      React.createElement('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
        React.createElement('span', { style: { fontSize: 13, fontWeight: 700, color: '#10B981' } }, fmt(total)),
        React.createElement('span', { style: { fontSize: 11, color: '#94A3B8' } }, open ? '▲' : '▼'),
      ),
    ),
    open && items.map((item, i) =>
      React.createElement('div', { key: i, style: S.assetRow },
        React.createElement('div', { style: { flex: 1 } },
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
            React.createElement('span', { style: S.assetName }, item.name),
            item.sub && React.createElement('span', { style: { fontSize: 11, color: '#94A3B8' } }, item.sub),
            BadgeEl(item.badge),
          ),
        ),
        React.createElement('span', { style: { fontSize: 13, fontWeight: 700, color: '#0F172A' } }, fmt(item.value)),
        React.createElement('div', { style: { display: 'flex', gap: 2 } },
          item.onEdit && React.createElement('button', { style: S.actionBtn, onClick: item.onEdit }, '✏️'),
          item.onDelete && React.createElement('button', { style: S.actionBtn, onClick: item.onDelete }, '🗑'),
        ),
      )
    )
  )
}

// ─── LiabilityGroup ──────────────────────────────────────────────────────
function LiabilityGroup({ icon, title, items }) {
  const [open, setOpen] = useState(true)
  const total = items.reduce((s, i) => s + (i.value || 0), 0)
  return React.createElement('div', { style: { marginBottom: 12 } },
    React.createElement('div', { style: S.groupHeader, onClick: () => setOpen(o => !o) },
      React.createElement('span', { style: { fontSize: 13 } }, `${icon} ${title}`),
      React.createElement('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
        React.createElement('span', { style: { fontSize: 13, fontWeight: 700, color: '#E11D48' } }, fmt(total)),
        React.createElement('span', { style: { fontSize: 11, color: '#94A3B8' } }, open ? '▲' : '▼'),
      ),
    ),
    open && items.map((item, i) =>
      React.createElement('div', { key: i, style: S.assetRow },
        React.createElement('div', { style: { flex: 1 } },
          React.createElement('div', { style: { display: 'flex', gap: 6, alignItems: 'center' } },
            React.createElement('span', { style: S.assetName }, item.name),
            BadgeEl(item.badge),
          ),
          item.sub && React.createElement('div', { style: { fontSize: 11, color: '#94A3B8' } }, item.sub),
        ),
        React.createElement('span', { style: { fontSize: 13, fontWeight: 700, color: '#E11D48' } }, fmt(item.value)),
        React.createElement('div', { style: { display: 'flex', gap: 2 } },
          item.onEdit && React.createElement('button', { style: S.actionBtn, onClick: item.onEdit }, '✏️'),
          item.onDelete && React.createElement('button', { style: S.actionBtn, onClick: item.onDelete }, '🗑'),
        ),
      )
    )
  )
}

// ─── גרף ─────────────────────────────────────────────────────────────────
function MiniChart({ data }) {
  if (!data || data.length < 2) {
    return React.createElement('div', { style: { height: 100, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, color: '#94A3B8', fontSize: 12 } },
      React.createElement('span', null, 'אין נתוני היסטוריה עדיין'),
      React.createElement('span', { style: { fontSize: 11 } }, 'לחץ "📸 שמור snapshot" כדי להתחיל לעקוב'),
    )
  }
  const W = 440, H = 100
  const vals = data.map(d => d.nw)
  const min = Math.min(...vals), max = Math.max(...vals), range = max - min || 1
  const pts = data.map((d, i) => [
    (i / (data.length - 1)) * (W - 20) + 10,
    H - ((d.nw - min) / range) * (H - 20) - 10,
  ])
  const pathD = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')
  const fillD = `${pathD} L${pts[pts.length-1][0]},${H} L${pts[0][0]},${H} Z`
  return React.createElement('svg', { width: '100%', viewBox: `0 0 ${W} ${H + 16}`, style: { overflow: 'visible' } },
    React.createElement('defs', null,
      React.createElement('linearGradient', { id: 'cg', x1: '0', y1: '0', x2: '0', y2: '1' },
        React.createElement('stop', { offset: '0%', stopColor: '#10B981', stopOpacity: '0.2' }),
        React.createElement('stop', { offset: '100%', stopColor: '#10B981', stopOpacity: '0.01' }),
      )
    ),
    React.createElement('path', { d: fillD, fill: 'url(#cg)' }),
    React.createElement('path', { d: pathD, fill: 'none', stroke: '#10B981', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }),
    React.createElement('circle', { cx: pts[pts.length-1][0], cy: pts[pts.length-1][1], r: 3.5, fill: '#10B981' }),
    [0, Math.floor((data.length-1)/2), data.length-1].map(i => data[i] &&
      React.createElement('text', { key: i, x: pts[i][0], y: H+14, fontSize: 9, fill: '#94A3B8', textAnchor: 'middle' }, data[i].ym?.slice(2))
    ),
  )
}

// ─── עוגה ────────────────────────────────────────────────────────────────
function PieChart({ data }) {
  if (!data.length) return null
  const CX = 50, CY = 50, R = 40, IR = 22
  let cum = 0
  const slices = data.map(d => { const s = cum; cum += d.pct; return { ...d, s, e: cum } })
  function arc(s, e) {
    const a1 = (s/100)*2*Math.PI - Math.PI/2, a2 = (e/100)*2*Math.PI - Math.PI/2
    const large = e - s > 50 ? 1 : 0
    const x1=CX+R*Math.cos(a1),y1=CY+R*Math.sin(a1),x2=CX+R*Math.cos(a2),y2=CY+R*Math.sin(a2)
    const xi1=CX+IR*Math.cos(a1),yi1=CY+IR*Math.sin(a1),xi2=CX+IR*Math.cos(a2),yi2=CY+IR*Math.sin(a2)
    return `M${xi1},${yi1} L${x1},${y1} A${R},${R} 0 ${large} 1 ${x2},${y2} L${xi2},${yi2} A${IR},${IR} 0 ${large} 0 ${xi1},${yi1} Z`
  }
  return React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 16 } },
    React.createElement('svg', { width: 120, height: 120, viewBox: '0 0 100 100', style: { flexShrink: 0 } },
      slices.map((s, i) => React.createElement('path', { key: i, d: arc(s.s, s.e), fill: s.color, opacity: 0.85 }))
    ),
    React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 5, flex: 1 } },
      data.map((d, i) =>
        React.createElement('div', { key: i, style: { display: 'flex', alignItems: 'center', gap: 6 } },
          React.createElement('div', { style: { width: 9, height: 9, borderRadius: 2, background: d.color, flexShrink: 0 } }),
          React.createElement('span', { style: { fontSize: 12, color: '#475569', flex: 1 } }, d.label),
          React.createElement('span', { style: { fontSize: 12, fontWeight: 600, color: '#0F172A' } }, `${d.pct}%`),
        )
      )
    )
  )
}

// ─── Badges ───────────────────────────────────────────────────────────────
function BadgeEl(badge) {
  const B = {
    auto:     { bg: '#DBEAFE', c: '#1E40AF', t: 'אוטומטי' },
    api:      { bg: '#D1FAE5', c: '#065F46', t: 'API' },
    override: { bg: '#FEF3C7', c: '#92400E', t: 'ידני' },
    manual:   { bg: '#F1F5F9', c: '#475569', t: 'ידני' },
    lent:     { bg: '#D1FAE5', c: '#065F46', t: 'הלוויתי' },
    loan:     { bg: '#FEE2E2', c: '#991B1B', t: 'הלוואה' },
    open:     { bg: '#FEF3C7', c: '#92400E', t: 'ללא פירעון' },
    credit:   { bg: '#FEE2E2', c: '#991B1B', t: 'אשראי' },
    overdraft:{ bg: '#FEE2E2', c: '#991B1B', t: 'אוברדראפט' },
  }
  const b = B[badge]; if (!b) return null
  return React.createElement('span', { style: { fontSize: 10, padding: '1px 6px', borderRadius: 6, background: b.bg, color: b.c, fontWeight: 600, whiteSpace: 'nowrap' } }, b.t)
}

// ─── מודאל נכס ────────────────────────────────────────────────────────────
function AssetModal({ editAsset, usdRate, onClose, onSave }) {
  const ASSET_TYPES = [
    { value: 'RealEstate', label: 'נדל"ן' },
    { value: 'Stock',      label: 'מניות / ני"ע' },
    { value: 'Savings',    label: 'פיקדון / חיסכון' },
    { value: 'Crypto',     label: 'קריפטו' },
    { value: 'Cash',       label: 'מזומן' },
    { value: 'Other',      label: 'אחר' },
  ]
  const [form, setForm] = useState({
    name:           editAsset?.name ?? '',
    type:           editAsset?.type ?? 'RealEstate',
    current_value:  editAsset?.current_value?.toString() ?? '',
    quantity:       editAsset?.quantity?.toString() ?? '1',
    ticker_symbol:  editAsset?.ticker_symbol ?? '',
    exchange:       editAsset?.exchange ?? '',
    price_override: editAsset?.price_override?.toString() ?? '',
    purchase_price: editAsset?.purchase_price?.toString() ?? '',
    purchase_date:  editAsset?.purchase_date ?? '',
  })
  const [error, setError]       = useState('')
  const [suggestions, setSuggestions] = useState([])
  const [livePrice, setLivePrice]     = useState(null)
  const [loading, setLoading]         = useState(false)
  const debounceRef = useRef(null)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleTickerInput = useCallback((val) => {
    set('ticker_symbol', val); setLivePrice(null)
    clearTimeout(debounceRef.current)
    if (!val) { setSuggestions([]); return }
    debounceRef.current = setTimeout(async () => {
      const res = await searchTicker(val); setSuggestions(res.slice(0, 6))
    }, 350)
  }, [])

  const selectSuggestion = useCallback(async (s) => {
    set('ticker_symbol', s.symbol); set('exchange', s.exchange)
    if (!form.name) set('name', s.name)
    setSuggestions([])
    setLoading(true)
    try {
      const { fetchPrice } = require('../db/priceService.js')
      const p = await fetchPrice(s.symbol)
      if (p) {
        const priceIls = p.currency === 'ILA' ? p.price/100 : p.currency === 'ILS' ? p.price : p.price*(usdRate??3.7)
        setLivePrice({ ...p, priceIls })
        if (!form.current_value) set('current_value', Math.round(priceIls).toString())
      }
    } catch {}
    setLoading(false)
  }, [form.name, form.current_value, usdRate])

  function handleSave() {
    if (!form.name) { setError('נא למלא שם'); return }
    const data = {
      name: form.name, type: form.type,
      current_value: parseFloat(form.current_value) || 0,
      quantity: parseFloat(form.quantity) || 1,
      ticker_symbol: form.ticker_symbol || null,
      exchange: form.exchange || null,
      price_override: form.price_override ? parseFloat(form.price_override) : null,
      purchase_price: form.purchase_price ? parseFloat(form.purchase_price) : null,
      purchase_date: form.purchase_date || null,
    }
    if (editAsset) {
      db.prepare(`UPDATE Assets SET name=?,type=?,current_value=?,quantity=?,ticker_symbol=?,exchange=?,price_override=?,purchase_price=?,purchase_date=? WHERE id=?`)
        .run(data.name,data.type,data.current_value,data.quantity,data.ticker_symbol,data.exchange,data.price_override,data.purchase_price,data.purchase_date,editAsset.id)
    } else {
      db.prepare(`INSERT INTO Assets (name,type,current_value,quantity,ticker_symbol,exchange,price_override,purchase_price,purchase_date,is_active) VALUES (?,?,?,?,?,?,?,?,?,1)`)
        .run(data.name,data.type,data.current_value,data.quantity,data.ticker_symbol,data.exchange,data.price_override,data.purchase_price,data.purchase_date)
    }
    onSave()
  }

  const needsTicker = ['Stock', 'Crypto'].includes(form.type)

  return React.createElement('div', { style: S.overlay },
    React.createElement('div', { style: { ...S.modal, maxWidth: 460 } },
      React.createElement('div', { style: S.modalHeader },
        React.createElement('h2', { style: S.modalTitle }, editAsset ? 'עריכת נכס' : 'נכס חדש'),
        React.createElement('button', { style: S.closeBtn, onClick: onClose }, '✕'),
      ),
      React.createElement('div', { style: S.modalBody },
        Field('סוג נכס', React.createElement('select', { style: S.input, value: form.type, onChange: e => set('type', e.target.value) },
          ASSET_TYPES.map(t => React.createElement('option', { key: t.value, value: t.value }, t.label))
        )),
        Field('שם הנכס', React.createElement('input', { style: S.input, value: form.name, onChange: e => set('name', e.target.value), placeholder: 'דירה ברחוב הרצל, תיק IBI...' })),

        needsTicker && React.createElement('div', { style: { marginBottom: 14, position: 'relative' } },
          React.createElement('label', { style: S.fieldLabel }, 'סימול (Ticker)'),
          React.createElement('input', {
            style: S.input, value: form.ticker_symbol,
            onChange: e => handleTickerInput(e.target.value),
            placeholder: 'AAPL, TEVA.TA, BTC-USD...',
          }),
          React.createElement('div', { style: { fontSize: 10, color: '#94A3B8', marginTop: 2 } }, 'מניות תל אביב: סיומת .TA (לדוג׳ TEVA.TA)'),
          suggestions.length > 0 && React.createElement('div', { style: S.dropdown },
            suggestions.map((s, i) =>
              React.createElement('div', { key: i, style: S.dropdownItem, onClick: () => selectSuggestion(s) },
                React.createElement('span', { style: { fontWeight: 600, fontSize: 13 } }, s.symbol),
                React.createElement('span', { style: { fontSize: 12, color: '#64748B', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: 6 } }, s.name),
                React.createElement('span', { style: { fontSize: 10, color: '#94A3B8' } }, s.exchange),
              )
            )
          ),
          livePrice && React.createElement('div', { style: { fontSize: 12, color: '#065F46', background: '#D1FAE5', padding: '4px 8px', borderRadius: 6, marginTop: 4 } },
            `${fmt(livePrice.priceIls)} ליח׳${livePrice.changePct != null ? ` · ${fmtPct(livePrice.changePct)} היום` : ''}`
          ),
        ),

        React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 } },
          Field('כמות', React.createElement('input', { style: S.input, type: 'number', step: '0.0001', value: form.quantity, onChange: e => set('quantity', e.target.value) })),
          Field('ערך ידני (₪)', React.createElement('input', { style: S.input, type: 'number', value: form.current_value, onChange: e => set('current_value', e.target.value), placeholder: needsTicker && form.ticker_symbol ? 'נשלף מ-API' : '0' })),
        ),

        React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 } },
          Field('מחיר קנייה ₪ ליחידה', React.createElement('input', { style: S.input, type: 'number', value: form.purchase_price, onChange: e => set('purchase_price', e.target.value), placeholder: 'אופציונלי' })),
          Field('תאריך קנייה', React.createElement('input', { style: S.input, type: 'date', value: form.purchase_date, onChange: e => set('purchase_date', e.target.value) })),
        ),

        needsTicker && form.ticker_symbol && React.createElement('div', { style: { marginBottom: 14 } },
          React.createElement('label', { style: S.fieldLabel }, 'דריסה ידנית (אופליין) — מחיר ₪ ליחידה'),
          React.createElement('div', { style: { display: 'flex', gap: 8 } },
            React.createElement('input', { style: { ...S.input, flex: 1 }, type: 'number', value: form.price_override, onChange: e => set('price_override', e.target.value), placeholder: 'ריק = השתמש ב-API' }),
            form.price_override && React.createElement('button', { style: S.btnSecondary, onClick: () => set('price_override', '') }, '✕'),
          ),
        ),
        error && React.createElement('p', { style: { color: '#E11D48', fontSize: 12 } }, error),
      ),
      React.createElement('div', { style: S.modalFooter },
        React.createElement('button', { style: S.btnSecondary, onClick: onClose }, 'ביטול'),
        React.createElement('button', { style: S.btnPrimary, onClick: handleSave }, 'שמור'),
      ),
    )
  )
}

// ─── מודאל חוב זמני ───────────────────────────────────────────────────────
function InformalDebtModal({ editDebt, onClose, onSave }) {
  const [form, setForm] = useState({
    name: editDebt?.name ?? '', amount: editDebt?.amount?.toString() ?? '',
    direction: editDebt?.direction ?? 'borrowed', due_date: editDebt?.due_date ?? '', notes: editDebt?.notes ?? '',
  })
  const [error, setError] = useState('')
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  function handleSave() {
    if (!form.name || !form.amount) { setError('נא למלא שם וסכום'); return }
    if (editDebt) {
      db.prepare('UPDATE Informal_Debts SET name=?,amount=?,direction=?,due_date=?,notes=? WHERE id=?')
        .run(form.name, parseFloat(form.amount), form.direction, form.due_date||null, form.notes||null, editDebt.id)
    } else {
      db.prepare('INSERT INTO Informal_Debts (name,amount,direction,due_date,notes,is_active) VALUES (?,?,?,?,?,1)')
        .run(form.name, parseFloat(form.amount), form.direction, form.due_date||null, form.notes||null)
    }
    onSave()
  }
  return React.createElement('div', { style: S.overlay },
    React.createElement('div', { style: { ...S.modal, maxWidth: 420 } },
      React.createElement('div', { style: S.modalHeader },
        React.createElement('h2', { style: S.modalTitle }, editDebt ? 'עריכת חוב זמני' : 'חוב זמני חדש'),
        React.createElement('button', { style: S.closeBtn, onClick: onClose }, '✕'),
      ),
      React.createElement('div', { style: S.modalBody },
        React.createElement('div', { style: { display: 'flex', border: '1px solid #E2E8F0', borderRadius: 10, overflow: 'hidden', marginBottom: 16 } },
          ['borrowed','lent'].map(dir =>
            React.createElement('button', { key: dir, style: { flex:1, padding:8, border:'none', fontSize:13, cursor:'pointer', fontWeight:600, background: form.direction===dir ? (dir==='borrowed'?'#E11D48':'#10B981') : '#F8FAFC', color: form.direction===dir?'#fff':'#475569' }, onClick: () => set('direction',dir) },
              dir==='borrowed' ? '📥 לקחתי הלוואה' : '📤 הלוויתי כסף'
            )
          )
        ),
        Field('שם / תיאור', React.createElement('input', { style: S.input, value: form.name, onChange: e => set('name', e.target.value), placeholder: 'הלוואה מאחי...' })),
        Field('סכום (₪)', React.createElement('input', { style: S.input, type: 'number', value: form.amount, onChange: e => set('amount', e.target.value) })),
        Field('תאריך החזר (אופציונלי)', React.createElement('input', { style: S.input, type: 'date', value: form.due_date, onChange: e => set('due_date', e.target.value) })),
        Field('הערות', React.createElement('input', { style: S.input, value: form.notes, onChange: e => set('notes', e.target.value) })),
        error && React.createElement('p', { style: { color: '#E11D48', fontSize: 12 } }, error),
      ),
      React.createElement('div', { style: S.modalFooter },
        React.createElement('button', { style: S.btnSecondary, onClick: onClose }, 'ביטול'),
        React.createElement('button', { style: S.btnPrimary, onClick: handleSave }, 'שמור'),
      ),
    )
  )
}

function Field(label, input) {
  return React.createElement('div', { style: { marginBottom: 14 } },
    React.createElement('label', { style: S.fieldLabel }, label),
    input,
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────
const S = {
  page:         { padding: 24, direction: 'rtl' },
  header:       { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  title:        { fontSize: 22, fontWeight: 700, color: '#0F172A' },
  btnPrimary:   { background: '#2563EB', color: '#fff', border: 'none', borderRadius: 10, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  btnSecondary: { background: '#F1F5F9', color: '#475569', border: '1px solid #E2E8F0', borderRadius: 10, padding: '8px 14px', fontSize: 13, cursor: 'pointer' },
  badgeBlue:    { background: '#DBEAFE', color: '#1E40AF', fontSize: 12, padding: '4px 10px', borderRadius: 8, fontWeight: 500 },
  badgeAmber:   { background: '#FEF3C7', color: '#92400E', fontSize: 12, padding: '4px 10px', borderRadius: 8, fontWeight: 500 },
  badgeGreen:   { background: '#D1FAE5', color: '#065F46', fontSize: 12, padding: '4px 10px', borderRadius: 8, fontWeight: 600 },
  kpiBar:       { display: 'grid', gridTemplateColumns: '2fr auto 1fr auto 1fr auto 1fr', gap: 0, background: '#fff', border: '1px solid #E2E8F0', borderRadius: 14, padding: '12px 20px', marginBottom: 20, alignItems: 'center' },
  kpiItem:      { textAlign: 'center' },
  kpiLabel:     { fontSize: 11, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 },
  kpiValue:     { fontSize: 20, fontWeight: 700 },
  kpiDivider:   { width: 1, height: 40, background: '#E2E8F0', margin: '0 16px' },
  mainGrid:     { display: 'grid', gridTemplateColumns: '1fr 1.6fr', gap: 16 },
  card:         { background: '#fff', borderRadius: 12, border: '1px solid #E2E8F0', padding: 16 },
  cardHeader:   { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  cardTitle:    { fontSize: 13, fontWeight: 600, color: '#0F172A' },
  rangeBtn:     { padding: '3px 8px', fontSize: 11, borderRadius: 6, border: '1px solid #E2E8F0', background: 'transparent', cursor: 'pointer', color: '#64748B' },
  rangeBtnActive: { background: '#2563EB', color: '#fff', border: '1px solid #2563EB' },
  sectionBanner: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: '#fff', fontWeight: 700, fontSize: 14, borderRadius: '8px 8px 0 0', margin: '-16px -16px 12px -16px', padding: '10px 16px' },
  groupHeader:  { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 10px', background: '#F8FAFC', borderRadius: 8, cursor: 'pointer', marginBottom: 4 },
  assetRow:     { display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderBottom: '1px solid #F1F5F9' },
  assetName:    { fontSize: 13, color: '#334155', fontWeight: 500 },
  colHeader:    { fontSize: 10, color: '#94A3B8', fontWeight: 600, textTransform: 'uppercase' },
  tickerBadge:  { fontSize: 10, background: '#EDE9FE', color: '#5B21B6', padding: '1px 5px', borderRadius: 4, fontWeight: 600 },
  actionBtn:    { background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, padding: '2px 4px', opacity: 0.6 },
  overlay:      { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 },
  modal:        { background: '#fff', borderRadius: 20, width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.15)', maxHeight: '90vh', overflowY: 'auto' },
  modalHeader:  { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 24px', borderBottom: '1px solid #E2E8F0' },
  modalTitle:   { fontSize: 16, fontWeight: 700, color: '#0F172A' },
  closeBtn:     { background: 'none', border: 'none', fontSize: 18, color: '#94A3B8', cursor: 'pointer' },
  modalBody:    { padding: 24 },
  modalFooter:  { display: 'flex', gap: 8, padding: '16px 24px', borderTop: '1px solid #E2E8F0' },
  input:        { width: '100%', border: '1px solid #E2E8F0', borderRadius: 10, padding: '8px 12px', fontSize: 13, outline: 'none', boxSizing: 'border-box' },
  inputSm:      { border: '1px solid #E2E8F0', borderRadius: 8, padding: '5px 8px', fontSize: 12, outline: 'none', boxSizing: 'border-box' },
  fieldLabel:   { fontSize: 12, fontWeight: 500, color: '#475569', display: 'block', marginBottom: 4 },
  dropdown:     { position: 'absolute', top: '100%', right: 0, left: 0, background: '#fff', border: '1px solid #E2E8F0', borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.1)', zIndex: 100, overflow: 'hidden' },
  dropdownItem: { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid #F1F5F9', direction: 'ltr', transition: 'background 0.1s' },
}

module.exports = NetWorth

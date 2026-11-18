const { normalizeMerchantName } = require('./transactionRules')

function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

function detectRecurringPatterns(rows, options = {}) {
  const minimumOccurrences = Math.max(3, Number(options.minimumOccurrences) || 5)
  const groups = new Map()
  for (const row of rows || []) {
    if (row.transaction_type !== 'Expense' || row.recurring_id != null || !row.business_entity) continue
    const date = String(row.transaction_date || '')
    if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(date)) continue
    const merchant = normalizeMerchantName(row.business_entity)
    if (!merchant) continue
    const key = `${row.account_id ?? 'none'}|${merchant}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push({ ...row, merchant, month: date.slice(0, 7), day: Number(date.slice(8, 10)) })
  }

  const suggestions = []
  for (const [key, items] of groups) {
    const byMonth = new Map()
    for (const item of items) {
      const current = byMonth.get(item.month)
      if (!current || Number(item.id) > Number(current.id)) byMonth.set(item.month, item)
    }
    const occurrences = [...byMonth.values()].sort((a, b) => a.transaction_date.localeCompare(b.transaction_date))
    if (occurrences.length < minimumOccurrences) continue
    const dayMedian = median(occurrences.map(x => x.day))
    const daySpread = Math.max(...occurrences.map(x => Math.abs(x.day - dayMedian)))
    if (daySpread > 8) continue
    const monthIndexes = occurrences.map(x => Number(x.month.slice(0, 4)) * 12 + Number(x.month.slice(5, 7)))
    const gaps = monthIndexes.slice(1).map((v, i) => v - monthIndexes[i])
    if (gaps.some(gap => gap < 1 || gap > 2)) continue
    const amounts = occurrences.map(x => Math.abs(Number(x.amount) || 0))
    const average = amounts.reduce((sum, value) => sum + value, 0) / amounts.length
    if (!(average > 0)) continue
    const min = Math.min(...amounts), max = Math.max(...amounts)
    if ((max - min) / average > 0.35) continue
    const categories = [...new Set(occurrences.map(x => x.category_id).filter(x => x != null).map(Number))]
    suggestions.push({
      key,
      name: occurrences[occurrences.length - 1].business_entity,
      account_id: occurrences[0].account_id,
      category_id: categories.length === 1 ? categories[0] : null,
      amount: Math.round(average * 100) / 100,
      is_estimated: max - min > Math.max(1, average * 0.01),
      charge_day: Math.max(1, Math.min(28, Math.round(dayMedian))),
      first_charge_date: occurrences[0].transaction_date,
      last_charge_date: occurrences[occurrences.length - 1].transaction_date,
      occurrences,
      transaction_ids: occurrences.map(x => x.id),
      count: occurrences.length,
      amount_min: min,
      amount_max: max,
    })
  }
  return suggestions.sort((a, b) => b.count - a.count || b.amount - a.amount)
}

module.exports = { detectRecurringPatterns }

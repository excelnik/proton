function parseLocalDate(value) {
  if (value instanceof Date) return new Date(value.getFullYear(), value.getMonth(), value.getDate())
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return null
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return date.getFullYear() === Number(match[1]) &&
    date.getMonth() === Number(match[2]) - 1 &&
    date.getDate() === Number(match[3]) ? date : null
}

function formatLocalDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function dateAtMonth(year, monthIndex, day) {
  const lastDay = new Date(year, monthIndex + 1, 0).getDate()
  return new Date(year, monthIndex, Math.min(day, lastDay))
}

function generateRecurringDates(template, today = new Date(), horizonMonths = 12) {
  const currentMonthIndex = today.getFullYear() * 12 + today.getMonth()
  const horizonEndIndex = currentMonthIndex + horizonMonths
  const firstDate = parseLocalDate(template.first_charge_date) ||
    new Date(today.getFullYear(), today.getMonth(), 1)
  const firstMonthIndex = firstDate.getFullYear() * 12 + firstDate.getMonth()
  const chargeDay = Number(template.charge_day) || firstDate.getDate() || 1
  const frequency = template.frequency || 'monthly'

  if (frequency === 'one_off') {
    const date = dateAtMonth(firstDate.getFullYear(), firstDate.getMonth(), firstDate.getDate())
    const monthIndex = date.getFullYear() * 12 + date.getMonth()
    return monthIndex >= currentMonthIndex && monthIndex < horizonEndIndex
      ? [formatLocalDate(date)]
      : []
  }

  const dates = []
  if (frequency === 'seasonal') {
    const months = new Set(String(template.season_months || '')
      .split(',')
      .map(value => Number(value.trim()))
      .filter(month => Number.isInteger(month) && month >= 1 && month <= 12))
    if (!months.size) return []
    for (let monthIndex = currentMonthIndex; monthIndex < horizonEndIndex; monthIndex++) {
      const year = Math.floor(monthIndex / 12)
      const month = monthIndex % 12
      if (!months.has(month + 1)) continue
      const date = dateAtMonth(year, month, chargeDay)
      if (date >= firstDate) dates.push(formatLocalDate(date))
    }
    return dates
  }

  const interval = ({ monthly: 1, bimonthly: 2, quarterly: 3, annual: 12 })[frequency] || 1
  const offset = Math.max(0, Math.ceil((currentMonthIndex - firstMonthIndex) / interval))
  for (let n = offset; ; n++) {
    const monthIndex = firstMonthIndex + n * interval
    if (monthIndex >= horizonEndIndex) break
    const year = Math.floor(monthIndex / 12)
    const month = monthIndex % 12
    const date = dateAtMonth(year, month, chargeDay)
    if (date >= firstDate) dates.push(formatLocalDate(date))
  }
  return dates
}

module.exports = { generateRecurringDates, formatLocalDate }

// ערכי viewScope אפשריים: 'all' | 'YYYY' (שנה) | 'YYYY-MM' (חודש)
function getScopeType(value) {
  if (value === 'all') return 'all'
  if (/^\d{4}$/.test(value)) return 'year'
  return 'month'
}

function getScopeRange(value) {
  const type = getScopeType(value)
  if (type === 'all') return { from: '1900-01-01', to: '2999-12-31' }
  if (type === 'year') return { from: `${value}-01-01`, to: `${value}-12-31` }
  return { from: `${value}-01`, to: `${value}-31` }
}

module.exports = { getScopeType, getScopeRange }

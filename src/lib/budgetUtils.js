function recurringMonthlyBudgetAmount(template) {
  if (!template || Number(template.minimum_commitment) === 0) return 0
  const amount = Math.abs(Number(template.amount) || 0)
  if (amount <= 0) return 0
  if (template.frequency === 'monthly') return amount
  if (template.frequency === 'bimonthly') return amount / 2
  if (template.frequency === 'quarterly') return amount / 3
  if (template.frequency === 'annual') return amount / 12
  if (template.frequency === 'seasonal') {
    const months = String(template.season_months || '').split(',')
      .map(value => Number(value.trim()))
      .filter(value => Number.isInteger(value) && value >= 1 && value <= 12)
    return amount * new Set(months).size / 12
  }
  return 0
}

function adjustPlanForRecurringImports(currentPlan, previousImported, nextImported) {
  return Math.max(0,
    (Number(currentPlan) || 0) -
    (Number(previousImported) || 0) +
    (Number(nextImported) || 0)
  )
}

module.exports = { recurringMonthlyBudgetAmount, adjustPlanForRecurringImports }

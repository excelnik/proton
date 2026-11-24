const test = require('node:test')
const assert = require('node:assert/strict')
const { recurringMonthlyBudgetAmount, adjustPlanForRecurringImports } = require('../src/lib/budgetUtils')

test('converts recurring frequencies into monthly budget amounts', () => {
  assert.equal(recurringMonthlyBudgetAmount({ amount: 120, frequency: 'monthly', minimum_commitment: 1 }), 120)
  assert.equal(recurringMonthlyBudgetAmount({ amount: 240, frequency: 'bimonthly', minimum_commitment: 1 }), 120)
  assert.equal(recurringMonthlyBudgetAmount({ amount: 300, frequency: 'quarterly', minimum_commitment: 1 }), 100)
  assert.equal(recurringMonthlyBudgetAmount({ amount: 1200, frequency: 'annual', minimum_commitment: 1 }), 100)
  assert.equal(recurringMonthlyBudgetAmount({ amount: 1200, frequency: 'seasonal', season_months: '3,6,9,12', minimum_commitment: 1 }), 400)
})

test('does not import one-off or non-committed payments as monthly fixed expenses', () => {
  assert.equal(recurringMonthlyBudgetAmount({ amount: 500, frequency: 'one_off', minimum_commitment: 1 }), 0)
  assert.equal(recurringMonthlyBudgetAmount({ amount: 500, frequency: 'monthly', minimum_commitment: 0 }), 0)
})

test('re-import updates only the recurring component and avoids duplicate additions', () => {
  assert.equal(adjustPlanForRecurringImports(900, 300, 350), 950)
  assert.equal(adjustPlanForRecurringImports(900, 300, 300), 900)
  assert.equal(adjustPlanForRecurringImports(100, 300, 0), 0)
})

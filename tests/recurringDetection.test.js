const test = require('node:test')
const assert = require('node:assert/strict')
const { detectRecurringPatterns } = require('../src/lib/recurringDetection')

function row(id, date, amount, extra = {}) {
  return { id, transaction_date: date, amount, transaction_type: 'Expense', business_entity: 'חברת חשמל', account_id: 2, category_id: 7, ...extra }
}

test('detects a monthly fixed payment after five occurrences', () => {
  const rows = [
    row(1, '2026-01-05', 420), row(2, '2026-02-06', 420),
    row(3, '2026-03-05', 420), row(4, '2026-04-06', 420),
    row(5, '2026-05-05', 420),
  ]
  const result = detectRecurringPatterns(rows)
  assert.equal(result.length, 1)
  assert.equal(result[0].count, 5)
  assert.equal(result[0].amount, 420)
  assert.equal(result[0].is_estimated, false)
  assert.deepEqual(result[0].transaction_ids, [1, 2, 3, 4, 5])
})

test('detects variable monthly payments and estimates their average', () => {
  const rows = [
    row(1, '2026-01-05', 390), row(2, '2026-02-05', 430),
    row(3, '2026-03-05', 410), row(4, '2026-04-05', 450),
    row(5, '2026-05-05', 420),
  ]
  const result = detectRecurringPatterns(rows)
  assert.equal(result.length, 1)
  assert.equal(result[0].is_estimated, true)
  assert.equal(result[0].amount, 420)
})

test('ignores too few, linked, non-expense, and irregular transactions', () => {
  const rows = [
    row(1, '2026-01-05', 100), row(2, '2026-02-05', 100),
    row(3, '2026-03-05', 100), row(4, '2026-04-05', 100, { recurring_id: 9 }),
    row(5, '2026-05-05', 100, { transaction_type: 'Income' }),
  ]
  assert.equal(detectRecurringPatterns(rows).length, 0)
  const irregular = [row(1, '2026-01-01', 100), row(2, '2026-02-25', 100), row(3, '2026-03-01', 100), row(4, '2026-04-26', 100), row(5, '2026-05-01', 100)]
  assert.equal(detectRecurringPatterns(irregular).length, 0)
})

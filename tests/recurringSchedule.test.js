const test = require('node:test')
const assert = require('node:assert/strict')
const { generateRecurringDates } = require('../src/lib/recurringSchedule')

const today = new Date(2026, 1, 1)

test('generates monthly and bimonthly schedules from the first charge date', () => {
  assert.deepEqual(generateRecurringDates({
    first_charge_date: '2026-01-15', charge_day: 15, frequency: 'monthly',
  }, today, 4), ['2026-02-15', '2026-03-15', '2026-04-15', '2026-05-15'])
  assert.deepEqual(generateRecurringDates({
    first_charge_date: '2026-01-15', charge_day: 15, frequency: 'bimonthly',
  }, today, 6), ['2026-03-15', '2026-05-15', '2026-07-15'])
})

test('generates quarterly and annual schedules at the intended intervals', () => {
  assert.deepEqual(generateRecurringDates({
    first_charge_date: '2025-11-10', charge_day: 10, frequency: 'quarterly',
  }, today, 12), ['2026-02-10', '2026-05-10', '2026-08-10', '2026-11-10'])
  assert.deepEqual(generateRecurringDates({
    first_charge_date: '2025-06-20', charge_day: 20, frequency: 'annual',
  }, today, 12), ['2026-06-20'])
})

test('generates seasonal months only and clamps charge day to month length', () => {
  assert.deepEqual(generateRecurringDates({
    first_charge_date: '2026-01-31', charge_day: 31, frequency: 'seasonal', season_months: '2,4',
  }, today, 5), ['2026-02-28', '2026-04-30'])
  assert.deepEqual(generateRecurringDates({
    first_charge_date: '2026-01-01', charge_day: 1, frequency: 'seasonal', season_months: '',
  }, today, 12), [])
})

test('one-off schedules produce at most one occurrence and do not repeat past charges', () => {
  assert.deepEqual(generateRecurringDates({
    first_charge_date: '2026-03-12', charge_day: 12, frequency: 'one_off',
  }, today, 12), ['2026-03-12'])
  assert.deepEqual(generateRecurringDates({
    first_charge_date: '2025-03-12', charge_day: 12, frequency: 'one_off',
  }, today, 12), [])
})

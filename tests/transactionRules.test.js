const test = require('node:test')
const assert = require('node:assert/strict')
const { ruleMatchesContext, filterEligibleRules } = require('../src/lib/transactionRules')

test('applies account and amount constraints inclusively', () => {
  const rule = { account_id: 3, min_amount: 50, max_amount: 200, enabled: 1 }
  assert.equal(ruleMatchesContext(rule, { accountId: 3, amount: 50 }), true)
  assert.equal(ruleMatchesContext(rule, { accountId: 3, amount: 200 }), true)
  assert.equal(ruleMatchesContext(rule, { accountId: 4, amount: 100 }), false)
  assert.equal(ruleMatchesContext(rule, { accountId: 3, amount: 49.99 }), false)
  assert.equal(ruleMatchesContext(rule, { accountId: 3, amount: 200.01 }), false)
})

test('applies date boundaries inclusively and refuses missing dates for date-scoped rules', () => {
  const rule = { valid_from: '2026-01-01', valid_to: '2026-12-31', enabled: 1 }
  assert.equal(ruleMatchesContext(rule, { date: '2026-01-01' }), true)
  assert.equal(ruleMatchesContext(rule, { date: '2026-12-31' }), true)
  assert.equal(ruleMatchesContext(rule, { date: '2025-12-31' }), false)
  assert.equal(ruleMatchesContext(rule, { date: null }), false)
})

test('disabled rules never match; unscoped rules remain eligible', () => {
  assert.equal(ruleMatchesContext({ enabled: 0 }, {}), false)
  assert.equal(ruleMatchesContext({}, {}), true)
  assert.deepEqual(filterEligibleRules([{ enabled: 0 }, {}, { account_id: 2 }], {}), [{}])
})

test('finds exact merchant rules without letting usage count override the match', () => {
  const { findBestMerchantRule } = require('../src/lib/transactionRules')
  const rules = [
    { original_string: 'supermarket alpha', category_id: 1, use_count: 99 },
    { original_string: 'supermarket beta', category_id: 2, use_count: 1 },
  ]
  assert.equal(findBestMerchantRule('Supermarket Beta', rules).category_id, 2)
})

test('returns no suggestion when fuzzy matches are weak or ambiguous', () => {
  const { findBestMerchantRule } = require('../src/lib/transactionRules')
  assert.equal(findBestMerchantRule('random unrelated merchant', [
    { original_string: 'alpha store', category_id: 1 },
  ]), null)
  assert.equal(findBestMerchantRule('supermarket alpha', [
    { original_string: 'supermarket alpha', category_id: 1 },
    { original_string: 'supermarket alpha', category_id: 2 },
  ]), null)
})

test('surfaces close merchant rule conflicts for an explicit manual category choice', () => {
  const { findScopedMerchantRule } = require('../src/lib/transactionRules')
  const rules = [
    { original_string: 'supermarket alpha', category_id: 1, enabled: 1 },
    { original_string: 'supermarket alpha', category_id: 2, enabled: 1 },
  ]
  const result = findScopedMerchantRule('supermarket alpha', rules, {})
  assert.equal(result.rule, null)
  assert.equal(result.outOfScope, false)
  assert.equal(result.conflicts.length, 2)
})

test('allows a strong unique token match but not arbitrary substring matches', () => {
  const { findBestMerchantRule } = require('../src/lib/transactionRules')
  assert.equal(findBestMerchantRule('ACME Store 123', [
    { original_string: 'ACME Store', category_id: 4 },
  ]).category_id, 4)
  assert.equal(findBestMerchantRule('cme', [
    { original_string: 'ACME Store', category_id: 4 },
  ]), null)
})

test('distinguishes an out-of-scope known merchant from an unknown merchant', () => {
  const { findScopedMerchantRule } = require('../src/lib/transactionRules')
  const rules = [
    { original_string: 'ACME Store', category_id: 4, min_amount: 100, enabled: 1 },
  ]
  assert.deepEqual(findScopedMerchantRule('ACME Store', rules, { amount: 150 }), {
    rule: { ...rules[0], _matchScore: 1 }, outOfScope: false,
  })
  assert.deepEqual(findScopedMerchantRule('ACME Store', rules, { amount: 50 }), {
    rule: null, outOfScope: true,
  })
  assert.deepEqual(findScopedMerchantRule('Different Merchant', rules, { amount: 50 }), {
    rule: null, outOfScope: false,
  })
})

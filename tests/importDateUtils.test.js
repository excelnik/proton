const test = require('node:test')
const assert = require('node:assert/strict')
const { parseImportDate } = require('../src/lib/importDateUtils')

test('parses Israeli dotted, slashed, and dashed dates', () => {
  assert.equal(parseImportDate('26.10.2026'), '2026-10-26')
  assert.equal(parseImportDate('7/3/2026'), '2026-03-07')
  assert.equal(parseImportDate('07-03-26'), '2026-03-07')
})

test('parses ISO dates and timestamps without shifting the calendar day', () => {
  assert.equal(parseImportDate('2026-10-26'), '2026-10-26')
  assert.equal(parseImportDate('2026-10-26T00:00:00.000Z'), '2026-10-26')
})

test('parses valid Date objects and Excel serial dates', () => {
  assert.equal(parseImportDate(new Date(2026, 9, 26)), '2026-10-26')
  assert.equal(parseImportDate(46221), '2026-07-18')
  assert.equal(parseImportDate('46221'), '2026-07-18')
})

test('rejects impossible or ambiguous dates instead of silently substituting today', () => {
  assert.equal(parseImportDate('31.02.2026'), '')
  assert.equal(parseImportDate('26'), '')
  assert.equal(parseImportDate('not a date'), '')
  assert.equal(parseImportDate(''), '')
  assert.equal(parseImportDate(null), '')
})

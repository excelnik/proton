const test = require('node:test')
const assert = require('node:assert/strict')
const XLSX = require('xlsx')
const { getPopulatedSheetRange } = require('../src/lib/importSheetUtils.js')

test('ignores oversized formatted !ref and style-only cells', () => {
  const sheet = {
    '!ref': 'A1:XFD1048576',
    A1: { v: 'תאריך' },
    B1: { v: 'סכום' },
    A2: { v: '01/02/2026' },
    B2: { v: 125 },
    Z100000: { s: { numFmt: 14 } },
  }
  assert.equal(getPopulatedSheetRange(sheet, XLSX.utils), 'A1:B2')
})

test('preserves sparse leading rows and columns', () => {
  const sheet = {
    '!ref': 'A1:Z99',
    C5: { v: 'תאריך' },
    D5: { v: 'סכום' },
    C6: { v: '01/02/2026' },
    D6: { v: 0 },
  }
  assert.equal(getPopulatedSheetRange(sheet, XLSX.utils), 'C5:D6')
})

test('returns null for sheets without populated cells', () => {
  assert.equal(getPopulatedSheetRange({ '!ref': 'A1:XFD1048576', A1: { s: {} } }, XLSX.utils), null)
})

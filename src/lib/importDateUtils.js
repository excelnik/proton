// Parsing helpers for dates imported from bank and credit-card exports.
// All successful results are normalized to YYYY-MM-DD without UTC conversions.

function isValidDateParts(year, month, day) {
  if (!Number.isInteger(year) || year < 1000 || year > 9999) return false
  if (!Number.isInteger(month) || month < 1 || month > 12) return false
  if (!Number.isInteger(day) || day < 1 || day > 31) return false
  const date = new Date(year, month - 1, day)
  return date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
}

function formatDateParts(year, month, day) {
  if (!isValidDateParts(year, month, day)) return ''
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function parseImportDate(value) {
  if (value === null || value === undefined || value === '') return ''
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value < 20000 || value > 2958465) return ''
    const date = new Date(1899, 11, 30); date.setDate(date.getDate() + Math.floor(value))
    return formatDateParts(date.getFullYear(), date.getMonth() + 1, date.getDate())
  }

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return ''
    return formatDateParts(value.getFullYear(), value.getMonth() + 1, value.getDate())
  }

  const text = String(value).trim()
  if (!text) return ''

  // ISO date or ISO timestamp: preserve the written calendar date.
  let match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:$|[T\s])/)
  if (match) return formatDateParts(Number(match[1]), Number(match[2]), Number(match[3]))

  // Israeli and common European formats: D.M.YYYY, D/M/YYYY, D-M-YYYY.
  match = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/)
  if (match) {
    const day = Number(match[1])
    const month = Number(match[2])
    let year = Number(match[3])
    if (match[3].length === 2) year += year >= 70 ? 1900 : 2000
    return formatDateParts(year, month, day)
  }

  // Excel serial dates occasionally arrive as numeric cells.
  if (/^\d+(?:\.\d+)?$/.test(text)) {
    const serial = Number(text)
    if (serial >= 20000 && serial <= 2958465) {
      const wholeDays = Math.floor(serial)
      const excelEpoch = new Date(1899, 11, 30)
      excelEpoch.setDate(excelEpoch.getDate() + wholeDays)
      return formatDateParts(excelEpoch.getFullYear(), excelEpoch.getMonth() + 1, excelEpoch.getDate())
    }
    return ''
  }

  // Avoid implementation-dependent Date parsing for ambiguous date strings.
  return ''
}

function formatImportPreviewCell(value) {
  if (value instanceof Date) return parseImportDate(value) || '—'
  return value || '—'
}

module.exports = { formatImportPreviewCell, parseImportDate }

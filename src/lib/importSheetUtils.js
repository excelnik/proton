// Return the smallest rectangular range containing actual cell values/formulas.
// SheetJS !ref may include formatted-but-empty rows/columns (sometimes up to Excel's
// maximum row), so using !ref directly can make sheet_to_json allocate huge arrays.
function getPopulatedSheetRange(sheet, utils) {
  if (!sheet || !utils || typeof utils.decode_cell !== 'function' || typeof utils.encode_cell !== 'function') return null

  let minRow = Infinity, minCol = Infinity, maxRow = -1, maxCol = -1
  for (const address of Object.keys(sheet)) {
    if (address[0] === '!') continue
    let cell
    try { cell = utils.decode_cell(address) } catch { continue }
    const value = sheet[address]
    if (!value || ((value.v === undefined || value.v === null || value.v === '') && !value.f)) continue
    minRow = Math.min(minRow, cell.r)
    minCol = Math.min(minCol, cell.c)
    maxRow = Math.max(maxRow, cell.r)
    maxCol = Math.max(maxCol, cell.c)
  }

  if (maxRow < 0 || maxCol < 0) return null
  return utils.encode_cell({ r: minRow, c: minCol }) + ':' + utils.encode_cell({ r: maxRow, c: maxCol })
}

module.exports = { getPopulatedSheetRange }

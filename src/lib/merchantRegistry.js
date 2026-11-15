const { normalizeMerchantName } = require('./transactionRules.js')

function getNormalizedName(name) {
  return normalizeMerchantName(name)
}

function registerMerchant(db, name) {
  const normalized = getNormalizedName(name)
  const displayName = String(name ?? '').trim()
  if (!normalized || !displayName) return null
  db.prepare(`
    INSERT OR IGNORE INTO Merchant_Registry (normalized_name, name, status)
    VALUES (?, ?, 'unrecognized')
  `).run(normalized, displayName)
  return db.prepare('SELECT * FROM Merchant_Registry WHERE normalized_name=?').get(normalized) || null
}

function approveMerchant(db, name) {
  const normalized = getNormalizedName(name)
  const displayName = String(name ?? '').trim()
  if (!normalized || !displayName) return null
  db.prepare(`
    INSERT INTO Merchant_Registry (normalized_name, name, status, updated_at)
    VALUES (?, ?, 'known', datetime('now'))
    ON CONFLICT(normalized_name) DO UPDATE SET
      name=excluded.name, status='known', updated_at=datetime('now')
  `).run(normalized, displayName)
  return db.prepare('SELECT * FROM Merchant_Registry WHERE normalized_name=?').get(normalized)
}

function setMerchantStatus(db, normalizedName, status) {
  if (!['known', 'unrecognized'].includes(status)) throw new Error('Invalid merchant status')
  db.prepare(`
    UPDATE Merchant_Registry SET status=?, updated_at=datetime('now')
    WHERE normalized_name=?
  `).run(status, normalizedName)
}

function listMerchants(db) {
  return db.prepare(`
    SELECT * FROM Merchant_Registry
    ORDER BY CASE status WHEN 'unrecognized' THEN 0 ELSE 1 END, name COLLATE NOCASE
  `).all()
}

function getMerchantStatus(db, name) {
  const normalized = getNormalizedName(name)
  if (!normalized) return 'unrecognized'
  return db.prepare('SELECT status FROM Merchant_Registry WHERE normalized_name=?').get(normalized)?.status || 'unrecognized'
}

module.exports = { getNormalizedName, registerMerchant, approveMerchant, setMerchantStatus, listMerchants, getMerchantStatus }

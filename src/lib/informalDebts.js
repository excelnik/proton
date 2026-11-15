function listInformalDebts(db) {
  return db.prepare(`
    SELECT d.*,
      COALESCE(SUM(p.amount), 0) AS repaid_amount,
      MAX(0, d.amount - COALESCE(SUM(p.amount), 0)) AS remaining_amount
    FROM Informal_Debts d
    LEFT JOIN Informal_Debt_Payments p ON p.debt_id=d.id
    GROUP BY d.id
    ORDER BY d.is_active DESC, d.id DESC
  `).all()
}

function createInformalDebt(db, input) {
  const name = String(input.name ?? '').trim()
  const amount = Number(input.amount)
  const direction = input.direction
  if (!name) throw new Error('יש להזין שם')
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('הסכום חייב להיות גדול מאפס')
  if (!['borrowed', 'lent'].includes(direction)) throw new Error('כיוון הלוואה לא תקין')
  const result = db.prepare(`
    INSERT INTO Informal_Debts (name, amount, direction, due_date, notes, is_active)
    VALUES (?, ?, ?, ?, ?, 1)
  `).run(name, amount, direction, input.due_date || null, input.notes || null)
  return Number(result.lastInsertRowid)
}

function recordInformalDebtPayment(db, input) {
  const amount = Number(input.amount)
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('סכום ההחזר חייב להיות גדול מאפס')
  if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(String(input.payment_date || ''))) throw new Error('תאריך החזר לא תקין')
  const debt = db.prepare('SELECT * FROM Informal_Debts WHERE id=? AND is_active=1').get(input.debt_id)
  if (!debt) throw new Error('ההלוואה לא נמצאה או שאינה פעילה')
  const paid = db.prepare('SELECT COALESCE(SUM(amount),0) AS total FROM Informal_Debt_Payments WHERE debt_id=?').get(debt.id).total
  const remaining = Math.max(0, Number(debt.amount) - Number(paid))
  if (amount > remaining + 0.00001) throw new Error('סכום ההחזר גדול מהיתרה שנותרה')
  if (input.transaction_id != null) {
    const tx = db.prepare('SELECT id, amount, transaction_type FROM Transactions WHERE id=?').get(input.transaction_id)
    if (!tx) throw new Error('התנועה המקושרת לא נמצאה')
    const expectedType = debt.direction === 'lent' ? 'Income' : 'Expense'
    if (tx.transaction_type !== expectedType) throw new Error('סוג התנועה אינו מתאים לכיוון ההחזר')
    if (Math.abs(Number(tx.amount) - amount) > 0.01) throw new Error('סכום התנועה חייב להיות זהה לסכום ההחזר')
    const linked = db.prepare('SELECT id FROM Informal_Debt_Payments WHERE transaction_id=?').get(tx.id)
    if (linked) throw new Error('התנועה כבר מקושרת להחזר אחר')
  }
  const result = db.prepare(`
    INSERT INTO Informal_Debt_Payments (debt_id, amount, payment_date, transaction_id, notes)
    VALUES (?, ?, ?, ?, ?)
  `).run(debt.id, amount, input.payment_date, input.transaction_id || null, input.notes || null)
  const newPaid = Number(paid) + amount
  if (newPaid >= Number(debt.amount) - 0.00001) {
    db.prepare('UPDATE Informal_Debts SET is_active=0 WHERE id=?').run(debt.id)
  }
  return Number(result.lastInsertRowid)
}

module.exports = { listInformalDebts, createInformalDebt, recordInformalDebtPayment }

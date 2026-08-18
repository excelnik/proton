// עזרי תאריכים משותפים

// הופך תאריך (מחרוזת 'YYYY-MM-DD' או Date) לאובייקט Date מקומי, בלי לעבור דרך new Date(string).
// new Date('YYYY-MM-DD') מפרש את המחרוזת כ-UTC-חצות, מה שיכול "להזיז" את היום ביום אחד קדימה
// או אחורה תלוי באזור הזמן המקומי של הסביבה שמריצה את הקוד — פירוש ידני נמנע מזה לגמרי.
function parseLocalDate(date) {
  if (date instanceof Date) return new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const [y, m, d] = String(date).slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d)
}

// מוסיף N חודשים לתאריך, ומגביל (clamp) ליום האחרון של חודש היעד אם היום המקורי לא קיים בו.
// לדוגמה: 31 בינואר + חודש -> 28/29 בפברואר (לא "גולש" למרץ כמו ב-Date.setMonth הרגיל).
function addMonthsClamped(date, months) {
  const d = parseLocalDate(date)
  const day = d.getDate()
  d.setDate(1) // מונע גלישה כבר בשלב ה-setMonth עצמו
  d.setMonth(d.getMonth() + months)
  const lastDayOfTargetMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  d.setDate(Math.min(day, lastDayOfTargetMonth))
  return d
}

// מחזירה 'YYYY-MM-DD' לפי הרכיבים המקומיים של התאריך — לא date.toISOString().slice(0,10),
// שממיר לזמן UTC ויכול "להזיז" את התאריך המוצג ביום אחד באזורי זמן שאינם UTC.
function formatLocalDate(date) {
  const d = date instanceof Date ? date : parseLocalDate(date)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

module.exports = { addMonthsClamped, parseLocalDate, formatLocalDate }

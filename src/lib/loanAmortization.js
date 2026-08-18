// לוח סילוקין להלוואות (שיטת שפיצר) — משותף בין Loans.jsx, Dashboard.jsx ו-NetWorth.jsx
// כדי שלנוסחה יהיה מקור אמת יחיד ולא כמה עותקים שיכולים להתפצל.
const { addMonthsClamped, parseLocalDate } = require('./dateUtils.js')

// בונה את לוח הסילוקין המלא של הלוואה, חודש אחר חודש.
// בגרייס מלא, הריבית שנצברת בכל חודש מצטרפת ליתרת הקרן (קפיטליזציה) במקום להיעלם,
// ולכן התשלום החודשי לתקופה הפעילה מחושב על יתרת הקרן בפועל בסיום הגרייס — לא על הסכום המקורי.
function generateAmortization(loan) {
  const { total_amount, interest_rate, first_payment_date, duration_months, grace_period_months, grace_type } = loan
  const monthlyRate = interest_rate / 100 / 12
  const graceMonths = grace_period_months || 0
  const activeDuration = duration_months - graceMonths

  let balance = total_amount
  let pmt = null
  const rows = []
  const startDate = parseLocalDate(first_payment_date)

  for (let i = 0; i < duration_months; i++) {
    const date = addMonthsClamped(startDate, i)
    const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

    const isGrace = i < graceMonths
    const interestPayment = balance * monthlyRate
    const openingBalance = balance
    let principalPayment = 0
    let monthlyPayment = 0

    if (isGrace) {
      if (grace_type === 'partial') {
        // גרייס חלקי: משלמים ריבית בלבד, הקרן לא זזה
        monthlyPayment = interestPayment
        principalPayment = 0
        balance = openingBalance
      } else {
        // גרייס מלא: לא משלמים כלום, הריבית שנצברה מצטרפת לקרן
        monthlyPayment = 0
        principalPayment = 0
        balance = openingBalance + interestPayment
      }
    } else {
      if (pmt === null) {
        // מחשבים את התשלום החודשי לפי יתרת הקרן בפועל בכניסה לתקופה הפעילה
        pmt = monthlyRate === 0
          ? balance / activeDuration
          : (balance * monthlyRate * Math.pow(1 + monthlyRate, activeDuration)) /
            (Math.pow(1 + monthlyRate, activeDuration) - 1)
      }
      monthlyPayment = pmt
      principalPayment = pmt - interestPayment
      balance = Math.max(0, balance - principalPayment)
    }

    rows.push({
      month: i + 1,
      date: dateStr,
      opening_principal: openingBalance,
      monthly_payment: monthlyPayment,
      interest_payment: interestPayment,
      principal_payment: principalPayment,
      closing_principal: balance,
      is_grace: isGrace,
    })
  }
  return rows
}

// מחזיר את אינדקס החודש הנוכחי בלוח הסילוקין (0-based), לפי הפרש חודשים קלנדריים מתאריך התשלום הראשון.
function getCurrentMonthIndex(loan) {
  const today = new Date()
  const start = new Date(loan.first_payment_date)
  const months = (today.getFullYear() - start.getFullYear()) * 12 + (today.getMonth() - start.getMonth())
  return Math.max(0, Math.min(months, loan.duration_months - 1))
}

module.exports = { generateAmortization, getCurrentMonthIndex }

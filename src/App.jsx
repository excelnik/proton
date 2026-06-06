const React = require('react')
const { useState, useEffect } = React
const Sidebar = require('./components/Sidebar.jsx')
const Dashboard = require('./pages/Dashboard.jsx')
const Accounts = require('./pages/Accounts.jsx')
const Transactions = require('./pages/Transactions.jsx')
const Import = require('./pages/Import.jsx')
const Categorize = require('./pages/Categorize.jsx')
const Budget = require('./pages/Budget.jsx')
const Maaser = require('./pages/Maaser.jsx')
const Settings = require('./pages/Settings.jsx')
const Loans = require('./pages/Loans.jsx')
const Insurance = require('./pages/Insurance.jsx')
const Savings = require('./pages/Savings.jsx')
const NetWorth = require('./pages/NetWorth.jsx')
const Recurring = require('./pages/Recurring.jsx')
const Categories = require('./pages/Categories.jsx')

function App() {
  const [currentPage, setCurrentPage] = useState('dashboard')
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })

  useEffect(() => {
    const tabMap = {
      '1': 'dashboard',
      '2': 'transactions',
      '3': 'import',
      '4': 'categorize',
      '5': 'recurring',
      '6': 'budget',
      '7': 'loans',
      '8': 'insurance',
      '9': 'savings',
      '0': 'networth',
      'מ': 'maaser',  'm': 'maaser', 'n': 'maaser',
      'ק': 'categories', 'k': 'categories',
      'ח': 'accounts',  'j': 'accounts',
      'ה': 'settings',  'h': 'settings',  'v': 'settings',
    }
    const handler = e => {
      if (!e.altKey) return
      if (tabMap[e.key]) {
        e.preventDefault()
        setCurrentPage(tabMap[e.key])
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  function renderPage() {
    if (currentPage === 'dashboard')    return React.createElement(Dashboard, { selectedMonth, setSelectedMonth })
    if (currentPage === 'accounts')     return React.createElement(Accounts)
    if (currentPage === 'transactions') return React.createElement(Transactions, { selectedMonth, setSelectedMonth })
    if (currentPage === 'import') return React.createElement(Import, { onNavigate: setCurrentPage })
    if (currentPage === 'categorize') return React.createElement(Categorize)
    if (currentPage === 'budget') return React.createElement(Budget, { selectedMonth, setSelectedMonth })
    if (currentPage === 'maaser') return React.createElement(Maaser, { selectedMonth, setSelectedMonth })
    if (currentPage === 'settings') return React.createElement(Settings)
    if (currentPage === 'loans') return React.createElement(Loans)
    if (currentPage === 'insurance') return React.createElement(Insurance)
    if (currentPage === 'savings') return React.createElement(Savings)
    if (currentPage === 'networth') return React.createElement(NetWorth)
    if (currentPage === 'recurring') return React.createElement(Recurring)
    if (currentPage === 'categories') return React.createElement(Categories)
    return React.createElement(Dashboard, { selectedMonth, setSelectedMonth })
  }

  return React.createElement('div', { style: styles.app },
    React.createElement(Sidebar, { currentPage, onNavigate: setCurrentPage }),
    React.createElement('main', { style: styles.main },
      renderPage()
    )
  )
}

const styles = {
  app: {
    display: 'flex',
    height: '100vh',
    overflow: 'hidden',
    direction: 'rtl',
    fontFamily: "'Segoe UI', Arial, sans-serif",
  },
  main: {
    flex: 1,
    overflowY: 'auto',
    backgroundColor: '#F8FAFC',
  },
}

module.exports = App
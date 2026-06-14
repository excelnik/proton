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
  const [updateNotification, setUpdateNotification] = useState(null)

  useEffect(() => {
    const { ipcRenderer } = require('electron')
    
    // עדכון זמין - הצג הודעה שקטה
    ipcRenderer.on('update-available', () => {
      console.log('✓ עדכון חדש זמין')
      setUpdateNotification({
        type: 'available',
        message: 'עדכון חדש זמין. מורידים...',
      })
    })
    
    // עדכון הורד - שאל את המשתמש
    ipcRenderer.on('update-downloaded', () => {
      console.log('✓ עדכון הורד וערוך להתקנה')
      setUpdateNotification({
        type: 'downloaded',
        message: 'עדכון חדש הורד ומוכן להתקנה',
      })
    })

    // שגיאה בעדכון
    ipcRenderer.on('update-error', (error) => {
      console.error('שגיאה בעדכון:', error)
      setUpdateNotification({
        type: 'error',
        message: 'שגיאה בעדכון: ' + error,
      })
    })

    return () => {
      ipcRenderer.removeAllListeners('update-available')
      ipcRenderer.removeAllListeners('update-downloaded')
      ipcRenderer.removeAllListeners('update-error')
    }
  }, [])

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
    ),
    // הודעת עדכון
    updateNotification && React.createElement('div', { style: { ...styles.updateBanner, ...(updateNotification.type === 'error' ? styles.errorBanner : updateNotification.type === 'downloaded' ? styles.successBanner : styles.infoBanner) } },
      React.createElement('div', { style: styles.updateContent },
        React.createElement('span', null, updateNotification.message),
        updateNotification.type === 'downloaded' && React.createElement('div', { style: { marginTop: 8, display: 'flex', gap: 8 } },
          React.createElement('button', {
            style: { ...styles.updateBtn, backgroundColor: '#10B981', color: 'white' },
            onClick: () => {
              const { ipcRenderer } = require('electron')
              ipcRenderer.send('restart-app')
            }
          }, '✓ הפעל מחדש עכשיו'),
          React.createElement('button', {
            style: { ...styles.updateBtn, backgroundColor: '#94A3B8', color: 'white' },
            onClick: () => setUpdateNotification(null)
          }, 'מאוחר יותר')
        )
      ),
      React.createElement('button', {
        style: styles.closeBanner,
        onClick: () => setUpdateNotification(null)
      }, '✕')
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
  updateBanner: {
    position: 'fixed',
    bottom: 20,
    left: 20,
    right: 20,
    padding: 16,
    borderRadius: 10,
    boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    zIndex: 1000,
    animation: 'slideUp 0.3s ease-out',
  },
  infoBanner: {
    backgroundColor: '#DBEAFE',
    color: '#1D4ED8',
    borderLeft: '4px solid #2563EB',
  },
  successBanner: {
    backgroundColor: '#D1FAE5',
    color: '#065F46',
    borderLeft: '4px solid #10B981',
  },
  errorBanner: {
    backgroundColor: '#FEE2E2',
    color: '#991B1B',
    borderLeft: '4px solid #EF4444',
  },
  updateContent: {
    flex: 1,
    fontSize: 14,
    lineHeight: '1.5',
  },
  updateBtn: {
    padding: '6px 12px',
    borderRadius: 6,
    border: 'none',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: '500',
  },
  closeBanner: {
    background: 'none',
    border: 'none',
    fontSize: 18,
    cursor: 'pointer',
    padding: 0,
    color: 'inherit',
    opacity: 0.6,
  },
}

module.exports = App

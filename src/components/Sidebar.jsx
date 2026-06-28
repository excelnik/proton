const React = require('react')

const NAV_ITEMS = [
  { id: 'dashboard',    icon: '🏠', label: 'דשבורד',        group: 'כללי' },
  { id: 'transactions', icon: '💸', label: 'תנועות',         group: 'כללי' },
  { id: 'import',       icon: '📥', label: 'ייבוא מהבנק',    group: 'כללי' },
  { id: 'categorize',   icon: '🏷️', label: 'סיווג תנועות',   group: 'כללי' },
  { id: 'budget',       icon: '📊', label: 'תכנון תקציב',    group: 'ניהול שוטף' },
  { id: 'maaser',       icon: '🕍', label: 'מעשרות',         group: 'ניהול שוטף' },
  { id: 'recurring',    icon: '🔄', label: 'תשלומים והו"ק',  group: 'התחייבויות' },
  { id: 'loans',        icon: '📉', label: 'הלוואות',        group: 'התחייבויות' },
  { id: 'insurance',    icon: '🛡️', label: 'ביטוחים',        group: 'התחייבויות' },
  { id: 'savings',      icon: '🎯', label: 'יעדי חיסכון',    group: 'צמיחה' },
  { id: 'networth',     icon: '💎', label: 'שווי נקי',       group: 'צמיחה' },
  { id: 'categories',   icon: '🏷️', label: 'קטגוריות',      group: 'מערכת' },
  { id: 'accounts',     icon: '🏦', label: 'חשבונות',        group: 'מערכת' },
  { id: 'settings',     icon: '⚙️', label: 'הגדרות',         group: 'מערכת' },
]

function Sidebar({ currentPage, onNavigate }) {
  const groups = {}
  NAV_ITEMS.forEach(item => {
    if (!groups[item.group]) groups[item.group] = []
    groups[item.group].push(item)
  })

  return React.createElement('aside', { style: styles.sidebar },
    React.createElement('div', { style: styles.logo },
      React.createElement('div', { style: styles.logoIcon }, 'P'),
      React.createElement('div', null,
        React.createElement('p', { style: styles.logoTitle }, 'פרוטון'),
        React.createElement('p', { style: styles.logoSub }, 'v0.3.1 בטא'),
      )
    ),
    React.createElement('nav', { style: styles.nav },
      Object.entries(groups).map(([groupName, items]) =>
        React.createElement('div', { key: groupName },
          React.createElement('p', { style: styles.groupLabel }, groupName),
          items.map(item =>
            React.createElement('button', {
              key: item.id,
              style: {
                ...styles.navItem,
                ...(currentPage === item.id ? styles.navItemActive : {}),
              },
              onClick: () => onNavigate(item.id),
            },
              React.createElement('span', null, item.icon),
              React.createElement('span', null, item.label),
            )
          )
        )
      )
    )
  )
}

const styles = {
  sidebar: {
    width: 220,
    flexShrink: 0,
    backgroundColor: '#ffffff',
    borderLeft: '1px solid #E2E8F0',
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    overflowY: 'auto',
  },
  logo: {
    padding: '16px',
    borderBottom: '1px solid #E2E8F0',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  logoIcon: {
    width: 34,
    height: 34,
    backgroundColor: '#2563EB',
    borderRadius: 10,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
    flexShrink: 0,
  },
  logoTitle: {
    fontWeight: 'bold',
    fontSize: 14,
    color: '#0F172A',
  },
  logoSub: {
    fontSize: 11,
    color: '#94A3B8',
  },
  nav: {
    flex: 1,
    padding: '8px',
  },
  groupLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: '#94A3B8',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    padding: '12px 8px 4px',
  },
  navItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    padding: '8px 10px',
    borderRadius: 10,
    border: 'none',
    backgroundColor: 'transparent',
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: '500',
    color: '#475569',
    textAlign: 'right',
    marginBottom: 2,
  },
  navItemActive: {
    backgroundColor: '#EFF6FF',
    color: '#2563EB',
  },
}

module.exports = Sidebar
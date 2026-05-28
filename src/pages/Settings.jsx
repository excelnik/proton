const React = require('react')
const { useState } = React
const db = require('../db/index.js')

const SETTINGS_KEYS = {
  DEFAULT_DAY: 'default_transaction_day',
  DATE_MODE: 'date_calc_mode',
}

function getSetting(key, fallback) {
  try {
    const row = db.prepare(
      "SELECT cleaned_name FROM Automation_Rules WHERE original_string=? AND match_type='setting'"
    ).get(key)
    return row ? row.cleaned_name : fallback
  } catch { return fallback }
}

function saveSetting(key, value) {
  try {
    const exists = db.prepare(
      "SELECT id FROM Automation_Rules WHERE original_string=? AND match_type='setting'"
    ).get(key)
    if (exists) {
      db.prepare("UPDATE Automation_Rules SET cleaned_name=? WHERE original_string=? AND match_type='setting'")
        .run(String(value), key)
    } else {
      db.prepare("INSERT INTO Automation_Rules (original_string, cleaned_name, match_type, priority, use_count) VALUES (?,?,'setting',0,0)")
        .run(key, String(value))
    }
  } catch {}
}

function Settings() {
  const [defaultDay, setDefaultDay] = useState(() => getSetting(SETTINGS_KEYS.DEFAULT_DAY, '25'))
  const [dateMode, setDateMode] = useState(() => getSetting(SETTINGS_KEYS.DATE_MODE, 'transaction_date'))
  const [emergencyMonths, setEmergencyMonths] = useState(() => getSetting('emergency_months', '3'))
  const [saved, setSaved] = useState(false)

  function handleSave() {
    saveSetting(SETTINGS_KEYS.DEFAULT_DAY, defaultDay)
    saveSetting(SETTINGS_KEYS.DATE_MODE, dateMode)
    saveSetting('emergency_months', emergencyMonths)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return React.createElement('div', { style: styles.page },
    React.createElement('h1', { style: styles.title }, 'הגדרות'),

    React.createElement('div', { style: styles.section },
      React.createElement('h2', { style: styles.sectionTitle }, 'תאריכים'),

      React.createElement('div', { style: styles.settingRow },
        React.createElement('div', null,
          React.createElement('p', { style: styles.settingLabel }, 'יום ברירת מחדל לחודשים קודמים'),
          React.createElement('p', { style: styles.settingDesc },
            'כשמוסיפים תנועה על חודש שעבר, איזה יום להשתמש כברירת מחדל?'
          ),
        ),
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          React.createElement('input', {
            type: 'number', min: 1, max: 28,
            style: styles.numInput,
            value: defaultDay,
            onChange: e => setDefaultDay(e.target.value),
          }),
          React.createElement('span', { style: { fontSize: 13, color: '#475569' } }, 'לחודש'),
        ),
      ),

      React.createElement('div', { style: { ...styles.settingRow, marginTop: 16, paddingTop: 16, borderTop: '1px solid #F1F5F9' } },
        React.createElement('div', null,
          React.createElement('p', { style: styles.settingLabel }, 'בסיס חישוב תאריך'),
          React.createElement('p', { style: styles.settingDesc },
            'על איזה תאריך יתבססו חישובי תקציב ודשבורד?'
          ),
        ),
        React.createElement('select', {
          style: { border: '1px solid #E2E8F0', borderRadius: 10, padding: '7px 12px', fontSize: 13, outline: 'none' },
          value: dateMode,
          onChange: e => setDateMode(e.target.value),
        },
          React.createElement('option', { value: 'transaction_date' }, 'תאריך עסקה'),
          React.createElement('option', { value: 'value_date' }, 'תאריך ערך'),
        ),
      ),

      React.createElement('div', { style: { ...styles.settingRow, marginTop: 16, paddingTop: 16, borderTop: '1px solid #F1F5F9' } },
        React.createElement('div', null,
          React.createElement('p', { style: styles.settingLabel }, 'חודשי מחיה בקרן חירום'),
          React.createElement('p', { style: styles.settingDesc }, 'כמה חודשי הוצאות לשמור בקרן החירום?'),
        ),
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          React.createElement('input', {
            type: 'number', min: 1, max: 12,
            style: styles.numInput,
            value: emergencyMonths,
            onChange: e => setEmergencyMonths(e.target.value),
          }),
          React.createElement('span', { style: { fontSize: 13, color: '#475569' } }, 'חודשים'),
        ),
      ),
    ),

    React.createElement('button', {
      style: { ...styles.btnPrimary, marginTop: 8 },
      onClick: handleSave,
    }, saved ? '✓ נשמר!' : 'שמור הגדרות'),
  )
}

const styles = {
  page: { padding: 32 },
  title: { fontSize: 22, fontWeight: 'bold', color: '#0F172A', marginBottom: 24 },
  section: { backgroundColor: '#fff', borderRadius: 16, border: '1px solid #E2E8F0', padding: 24, marginBottom: 16 },
  sectionTitle: { fontSize: 15, fontWeight: '600', color: '#0F172A', marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid #E2E8F0' },
  settingRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 },
  settingLabel: { fontSize: 14, fontWeight: '500', color: '#0F172A', marginBottom: 4 },
  settingDesc: { fontSize: 12, color: '#94A3B8' },
  numInput: { width: 64, border: '1px solid #E2E8F0', borderRadius: 10, padding: '7px 12px', fontSize: 14, textAlign: 'center', outline: 'none' },
  btnPrimary: { backgroundColor: '#2563EB', color: '#fff', border: 'none', borderRadius: 10, padding: '9px 20px', fontSize: 13, fontWeight: '500', cursor: 'pointer' },
}

module.exports = Settings
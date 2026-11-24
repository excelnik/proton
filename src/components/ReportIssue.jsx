const React = require('react')
const { useState } = React
const { ipcRenderer } = require('electron')

const PAGE_NAMES = {
  dashboard: 'דשבורד',
  transactions: 'תנועות',
  import: 'ייבוא מהבנק',
  categorize: 'סיווג תנועות',
  budget: 'תכנון תקציב',
  maaser: 'מעשרות',
  recurring: 'תשלומים והוראות קבע',
  loans: 'הלוואות',
  insurance: 'ביטוחים',
  savings: 'יעדי חיסכון',
  networth: 'שווי נקי',
  categories: 'קטגוריות',
  accounts: 'חשבונות',
  settings: 'הגדרות',
}

function ReportIssue({ onClose, currentPage }) {
  const [type, setType] = useState('bug')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [steps, setSteps] = useState('')
  const [includeTrace, setIncludeTrace] = useState(true)
  const [saving, setSaving] = useState(false)

  async function exportReport() {
    if (!description.trim()) {
      alert('נא לתאר בקצרה מה קרה או מה תרצה לשנות.')
      return
    }
    setSaving(true)
    try {
      const diagnostics = window.__prutonDiagnostics || {}
      const report = {
        reportFormat: 'pruton-diagnostic-v1',
        reportType: type,
        title: title.trim(),
        description: description.trim(),
        reproductionSteps: steps.trim(),
        createdAt: new Date().toISOString(),
        location: {
          pageId: currentPage || window.__prutonCurrentPage || 'unknown',
          pageName: PAGE_NAMES[currentPage || window.__prutonCurrentPage] || 'לא ידוע',
          lastInteraction: diagnostics.lastInteraction || null,
        },
        recentInteractions: includeTrace ? (diagnostics.interactions || []).slice(-40) : [],
        runtimeErrors: includeTrace ? (diagnostics.errors || []).slice(-20) : [],
        privacy: {
          formValuesCaptured: false,
          transactionDataCaptured: false,
          screenshotIncluded: false,
          note: 'The report contains UI labels and technical error metadata only; it does not intentionally collect input values or financial transaction records.',
        },
      }
      const result = await ipcRenderer.invoke('save-diagnostic-report', report)
      if (result?.success) {
        alert('דוח האבחון נשמר בהצלחה:\n' + result.path)
        onClose()
      } else if (!result?.cancelled) {
        alert('לא ניתן לשמור את הדוח: ' + (result?.error || 'שגיאה לא ידועה'))
      }
    } catch (error) {
      alert('שגיאה ביצירת הדוח: ' + (error?.message || String(error)))
    } finally {
      setSaving(false)
    }
  }

  const field = {
    width: '100%', boxSizing: 'border-box', border: '1px solid #CBD5E1',
    borderRadius: 8, padding: 10, fontSize: 13, fontFamily: 'inherit',
  }

  return React.createElement('div', {
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': 'דיווח ותיעוד',
    style: { position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(15,23,42,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18 },
  },
    React.createElement('div', { style: { width: '100%', maxWidth: 620, maxHeight: '90vh', overflowY: 'auto', background: '#fff', borderRadius: 16, boxShadow: '0 20px 60px rgba(0,0,0,.25)', direction: 'rtl' } },
      React.createElement('div', { style: { padding: '18px 22px', borderBottom: '1px solid #E2E8F0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
        React.createElement('div', null,
          React.createElement('h2', { style: { margin: 0, fontSize: 18, color: '#0F172A' } }, 'דיווח ותיעוד'),
          React.createElement('p', { style: { margin: '5px 0 0', fontSize: 12, color: '#64748B' } }, 'הדוח יזהה את המסך והפעולות האחרונות כדי שאפשר יהיה להבין בדיוק למה התכוונת.'),
        ),
        React.createElement('button', { onClick: onClose, 'aria-label': 'סגור', style: { border: 0, background: 'transparent', fontSize: 22, cursor: 'pointer', color: '#64748B' } }, '×'),
      ),
      React.createElement('div', { style: { padding: 22, display: 'grid', gap: 14 } },
        React.createElement('div', { style: { background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 10, padding: 12, fontSize: 13 } },
          React.createElement('strong', null, 'המיקום שזוהה: '),
          PAGE_NAMES[currentPage] || currentPage || 'לא ידוע',
          React.createElement('p', { style: { margin: '5px 0 0', color: '#64748B', fontSize: 11 } }, 'פרטי המסך, רכיב אחרון שנלחץ ושגיאות טכניות יתווספו אוטומטית.'),
        ),
        React.createElement('label', { style: { display: 'grid', gap: 6, fontSize: 13, fontWeight: 600 } },
          'סוג הדיווח',
          React.createElement('select', { value: type, onChange: e => setType(e.target.value), style: field },
            React.createElement('option', { value: 'bug' }, 'תקלה – משהו לא עובד'),
            React.createElement('option', { value: 'improvement' }, 'דיוק – משהו עובד אחרת מהרצוי'),
            React.createElement('option', { value: 'feature' }, 'רעיון – תכונה חדשה'),
            React.createElement('option', { value: 'question' }, 'שאלה – משהו לא ברור'),
          ),
        ),
        React.createElement('label', { style: { display: 'grid', gap: 6, fontSize: 13, fontWeight: 600 } },
          'כותרת קצרה (לא חובה)',
          React.createElement('input', { value: title, onChange: e => setTitle(e.target.value), placeholder: 'למשל: שינוי קטגוריה לא נשמר', style: field, maxLength: 120 }),
        ),
        React.createElement('label', { style: { display: 'grid', gap: 6, fontSize: 13, fontWeight: 600 } },
          'תאר במילים שלך מה קרה או מה תרצה',
          React.createElement('textarea', { value: description, onChange: e => setDescription(e.target.value), rows: 4, placeholder: 'אין צורך במונחים טכניים. כתוב מה ניסית לעשות ומה ציפית שיקרה.', style: { ...field, resize: 'vertical' } }),
        ),
        React.createElement('label', { style: { display: 'grid', gap: 6, fontSize: 13, fontWeight: 600 } },
          'מה עשית לפני כן? (לא חובה)',
          React.createElement('textarea', { value: steps, onChange: e => setSteps(e.target.value), rows: 2, placeholder: 'לדוגמה: פתחתי תנועות, סימנתי שלוש שורות ולחצתי על שינוי קטגוריה.', style: { ...field, resize: 'vertical' } }),
        ),
        React.createElement('label', { style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#475569', fontWeight: 400 } },
          React.createElement('input', { type: 'checkbox', checked: includeTrace, onChange: e => setIncludeTrace(e.target.checked) }),
          'לצרף את 40 הפעולות האחרונות ושגיאות טכניות (מומלץ)',
        ),
        React.createElement('p', { style: { margin: 0, fontSize: 11, lineHeight: 1.5, color: '#64748B' } }, 'הדוח אינו כולל בכוונה ערכי שדות, סכומי עסקאות או צילום מסך. לפני שליחה אליי אפשר לפתוח את קובץ ה־JSON ולבדוק את תוכנו.'),
      ),
      React.createElement('div', { style: { padding: '14px 22px', borderTop: '1px solid #E2E8F0', display: 'flex', gap: 8, justifyContent: 'flex-start' } },
        React.createElement('button', { onClick: onClose, disabled: saving, style: { padding: '9px 16px', borderRadius: 8, border: '1px solid #CBD5E1', background: '#fff', cursor: 'pointer' } }, 'ביטול'),
        React.createElement('button', { onClick: exportReport, disabled: saving, style: { padding: '9px 18px', borderRadius: 8, border: 0, background: '#2563EB', color: '#fff', cursor: saving ? 'wait' : 'pointer', fontWeight: 600 } }, saving ? 'יוצר דוח...' : 'צור דוח לשיתוף'),
      ),
    ),
  )
}

module.exports = ReportIssue

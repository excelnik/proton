const fs = require('fs')
const path = require('path')
const os = require('os')

const MAX_LOG_BYTES = 5 * 1024 * 1024 // 5MB

function initCrashLogger(logDir) {
  try {
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true })
    }
  } catch {
    return
  }

  const logFile = path.join(logDir, 'crash.log')

  function getHostname() {
    try { return os.hostname() } catch { return 'unknown' }
  }

  function rotateIfNeeded() {
    try {
      const stat = fs.statSync(logFile)
      if (stat.size >= MAX_LOG_BYTES) {
        const rotated = logFile + '.old'
        if (fs.existsSync(rotated)) fs.unlinkSync(rotated)
        fs.renameSync(logFile, rotated)
      }
    } catch {
      // אם הקובץ לא קיים עדיין — בסדר
    }
  }

  function writeLog(type, error) {
    try {
      rotateIfNeeded()
      const timestamp = new Date().toISOString()
      const message = error?.stack || (error?.message ?? String(error))
      const lines = [
        '',
        '='.repeat(80),
        `[${timestamp}] ${type}`,
        `Node: ${process.version}`,
        `Platform: ${process.platform}`,
        `Arch: ${process.arch}`,
        `Hostname: ${getHostname()}`,
        '',
        message,
        '='.repeat(80),
        ''
      ]
      fs.appendFileSync(logFile, lines.join('\n'), 'utf8')
    } catch {
      // לא זורקים שגיאה מתוך מנגנון הלוג עצמו
    }
  }

  process.on('uncaughtException', (error) => {
    writeLog('uncaughtException', error)
  })

  process.on('unhandledRejection', (reason) => {
    writeLog('unhandledRejection', reason)
  })

  process.on('warning', (warning) => {
    // מסנן warnings תכופים/שגרתיים — רושם רק מה שרלוונטי לדיבוג
    const ignored = ['ExperimentalWarning', 'DeprecationWarning']
    if (!ignored.includes(warning.name)) {
      writeLog('warning', warning)
    }
  })

  writeLog('startup', { message: `Crash logger initialized (PID ${process.pid})` })

  return logFile
}

module.exports = {
  initCrashLogger,
}

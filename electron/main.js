const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron')
const path = require('path')
const os = require('os')
const fs = require('fs')
const { autoUpdater } = require('electron-updater')
const { initCrashLogger } = require('../crashLogger')
const Database = require('better-sqlite3')
initCrashLogger(path.join(os.homedir(), 'AppData', 'Roaming', 'proton'))

const DB_PATH = path.join(os.homedir(), 'AppData', 'Roaming', 'proton')
process.env.PROTON_DB_PATH = DB_PATH

let mainWindow
let updateAvailable = false
let updateDownloaded = false

function createMenu() {
  const template = [
    {
      label: 'קובץ',
      submenu: [
        { role: 'quit', label: 'יציאה' }
      ]
    },
    {
      label: 'עריכה',
      submenu: [
        { role: 'undo', label: 'בטל' },
        { role: 'redo', label: 'בצע מחדש' },
        { type: 'separator' },
        { role: 'cut', label: 'גזור' },
        { role: 'copy', label: 'העתק' },
        { role: 'paste', label: 'הדבק' },
        { role: 'selectAll', label: 'בחר הכל' },
      ]
    },
    {
      label: 'תצוגה',
      submenu: [
        { role: 'reload', label: 'רענן' },
        { role: 'toggleDevTools', label: 'כלי מפתחים' },
        { type: 'separator' },
        { role: 'resetZoom', label: 'איפוס תקריב' },
        { role: 'zoomIn', label: 'הגדל' },
        { role: 'zoomOut', label: 'הקטן' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'מסך מלא' },
      ]
    },
    {
      label: 'עזרה',
      submenu: [
        {
          label: 'מדריך למשתמש',
          click: () => {
            const guideWindow = new BrowserWindow({
              width: 1100,
              height: 800,
              title: 'מדריך למשתמש - פרוטון',
            })
            guideWindow.loadURL('https://excelnik.github.io/proton/guide.html')
          }
        }
      ]
    }
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

function createWindow() {
  mainWindow = new BrowserWindow({
    icon: path.join(__dirname, '../assets/icon.ico'),
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
    title: 'פרוטון',
    backgroundColor: '#F8FAFC',
    show: false,
  })

  mainWindow.loadFile(path.join(__dirname, '../public/index.html'))

  // עדכונים: מורידים ברקע, אך ההתקנה מתבצעת רק לאחר אישור המשתמש.
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.allowPrerelease = true

  autoUpdater.on('update-available', () => {
    updateAvailable = true
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('update-available')
  })

  autoUpdater.on('update-not-available', () => {
    console.info('Pruton is up to date.')
  })

  autoUpdater.on('update-downloaded', () => {
    updateDownloaded = true
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('update-downloaded')
  })

  autoUpdater.on('error', (error) => {
    const rawMessage = error?.message || String(error)
    const message = /No published versions on GitHub/i.test(rawMessage)
      ? 'לא נמצאה גרסה שפורסמה ב-GitHub Releases. העדכון האוטומטי יפעל לאחר פרסום גרסה רשמית.'
      : rawMessage
    console.error('עדכון שגיאה:', rawMessage)
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('update-error', message)
  })

  if (app.isPackaged) {
    autoUpdater.checkForUpdates().catch(error => console.error('בדיקת עדכונים נכשלה:', error))
    setInterval(() => {
      autoUpdater.checkForUpdates().catch(error => console.error('בדיקת עדכונים נכשלה:', error))
    }, 60 * 60 * 1000)
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
  })
}

app.whenReady().then(() => {
  createMenu()
  createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

// ──── עדכון אוטומטי ────
ipcMain.on('restart-app', () => {
  if (updateDownloaded) {
    autoUpdater.quitAndInstall()
  } else {
    app.quit()
  }
})


// ──── ייצוא דוח אבחון לשיתוף ────
ipcMain.handle('save-diagnostic-report', async (event, report) => {
  try {
    const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
      defaultPath: `Pruton-diagnostic-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
      filters: [{ name: 'דוח אבחון (JSON)', extensions: ['json'] }]
    })
    if (canceled || !filePath) return { success: false, cancelled: true }

    const crashLogPath = path.join(os.homedir(), 'AppData', 'Roaming', 'proton', 'crash.log')
    let crashLog = null
    try {
      if (fs.existsSync(crashLogPath)) {
        const raw = fs.readFileSync(crashLogPath, 'utf8')
        crashLog = raw.slice(-100000)
      }
    } catch {}

    const completeReport = {
      ...report,
      system: {
        appVersion: app.getVersion(),
        electronVersion: process.versions.electron,
        nodeVersion: process.version,
        platform: process.platform,
        architecture: process.arch,
        crashLog,
      },
      exportedAt: new Date().toISOString(),
    }
    fs.writeFileSync(filePath, JSON.stringify(completeReport, null, 2), 'utf8')
    return { success: true, path: filePath }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

// ──── ייצוא גיבוי ────
ipcMain.handle('export-db', async (event, srcPath) => {
  try {
    const { filePath } = await dialog.showSaveDialog({
      defaultPath: `proton-backup-${new Date().toISOString().slice(0,10)}.db`,
      filters: [{ name: 'Database', extensions: ['db'] }]
    })
    if (!filePath) return { success: false, cancelled: true }

    // לוודא שכל הנתונים מה-WAL נכתבו לקובץ הראשי לפני ההעתקה
    const liveDb = new Database(srcPath)
    liveDb.pragma('wal_checkpoint(TRUNCATE)')
    liveDb.close()

    fs.copyFileSync(srcPath, filePath)
    return { success: true, path: filePath }
  } catch(e) {
    return { success: false, error: e.message }
  }
})

// ──── ייבוא גיבוי ────
ipcMain.handle('import-db', async (event, destPath) => {
  try {
    const { filePaths } = await dialog.showOpenDialog({
      filters: [{ name: 'Database', extensions: ['db'] }],
      properties: ['openFile']
    })
    if (!filePaths || filePaths.length === 0) return { success: false, cancelled: true }
    fs.copyFileSync(filePaths[0], destPath)
    return { success: true }
  } catch(e) {
    return { success: false, error: e.message }
  }
})

// ──── מחיקת בטוחה של נתונים + סגירה (ללא הסרה אוטומטית) ────
ipcMain.handle('safe-delete-db', async (event, dbPath) => {
  try {
    // הגנה: הפעולה מיועדת רק למסד הנתונים של פרוטון.
    if (path.basename(dbPath) !== 'proton.db' || path.basename(path.dirname(dbPath)) !== 'proton') {
      return { success: false, error: 'נתיב מסד הנתונים אינו הנתיב המוכר של פרוטון' }
    }
    const dbDir = path.dirname(dbPath)
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true })
      return { success: true, backupPath: null, message: 'נוצרה תיקיית נתונים חדשה' }
    }

    // לא מוחקים: מעבירים את כל התיקייה (DB, WAL, SHM וקובצי עזר) לגיבוי מתוארך.
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    let backupDir = path.join(path.dirname(dbDir), 'proton_backup_' + stamp)
    let suffix = 1
    while (fs.existsSync(backupDir)) {
      backupDir = path.join(path.dirname(dbDir), 'proton_backup_' + stamp + '_' + suffix++)
    }
    fs.renameSync(dbDir, backupDir)
    fs.mkdirSync(dbDir, { recursive: true })

    return { success: true, backupPath: backupDir, message: 'הנתונים הישנים נשמרו בגיבוי ונוצרה תיקייה נקייה' }
  } catch (e) {
    return { success: false, error: e.message }
  }
})

// ──── סגירת אפליקציה נקייה (ללא הסרה אוטומטית) ────
ipcMain.on('quit-app', () => {
  // סגור את האפליקציה בלבד
  // לא נריץ Uninstall Pruton.exe — תן למשתמש להסיר באופן ידני
  app.quit()
})

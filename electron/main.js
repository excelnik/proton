const { app, BrowserWindow, ipcMain, dialog } = require('electron')
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

  // בדוק עדכונים כל שעה, לא באופן מיידי
  autoUpdater.checkForUpdatesAndNotify()
  setInterval(() => {
    autoUpdater.checkForUpdates()
  }, 60 * 60 * 1000) // כל שעה

  autoUpdater.on('update-available', () => {
    updateAvailable = true
    mainWindow.webContents.send('update-available')
  })

  autoUpdater.on('update-downloaded', () => {
    updateDownloaded = true
    mainWindow.webContents.send('update-downloaded')
  })

  autoUpdater.on('error', (error) => {
    console.error('עדכון שגיאה:', error)
    mainWindow.webContents.send('update-error', error.message)
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
  })
}

app.whenReady().then(createWindow)

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
    // בדוק אם הקובץ קיים
    if (!fs.existsSync(dbPath)) {
      return { success: false, error: 'קובץ נתונים לא נמצא' }
    }

    // מחק את הקובץ הראשי וגם את WAL/SHM הנלווים
    fs.rmSync(dbPath, { force: true })
    fs.rmSync(dbPath + '-wal', { force: true })
    fs.rmSync(dbPath + '-shm', { force: true })

    // וודא שנמחק
    if (fs.existsSync(dbPath)) {
      return { success: false, error: 'לא הצלחנו למחוק את קובץ הנתונים' }
    }

    return { success: true, message: 'הנתונים נמחקו בהצלחה' }
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

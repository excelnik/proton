const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const path = require('path')
const os = require('os')
const fs = require('fs')
const { autoUpdater } = require('electron-updater')
const { initCrashLogger } = require('../crashLogger')
initCrashLogger(path.join(os.homedir(), 'AppData', 'Roaming', 'proton'))

const DB_PATH = path.join(os.homedir(), 'AppData', 'Roaming', 'proton')
process.env.PROTON_DB_PATH = DB_PATH

let mainWindow

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

  autoUpdater.checkForUpdatesAndNotify()

  autoUpdater.on('update-available', () => {
    mainWindow.webContents.send('update-available')
  })

  autoUpdater.on('update-downloaded', () => {
    mainWindow.webContents.send('update-downloaded')
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

ipcMain.on('restart-app', () => {
  autoUpdater.quitAndInstall()
})

ipcMain.handle('export-db', async (event, srcPath) => {
  try {
    const { filePath } = await dialog.showSaveDialog({
      defaultPath: `proton-backup-${new Date().toISOString().slice(0,10)}.db`,
      filters: [{ name: 'Database', extensions: ['db'] }]
    })
    if (!filePath) return { success: false, cancelled: true }
    fs.copyFileSync(srcPath, filePath)
    return { success: true, path: filePath }
  } catch(e) {
    return { success: false, error: e.message }
  }
})

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

ipcMain.on('quit-app', () => {
  const { execSync } = require('child_process')
  const uninstallerPath = require('path').join(
    process.env.LOCALAPPDATA, 'Programs', 'proton', 'Uninstall Pruton.exe'
  )
  app.quit()
  try {
    require('child_process').spawn(uninstallerPath, ['/S'], { detached: true })
  } catch(e) {
    // אם לא נמצא — המשתמש יסיר ידנית
  }
})
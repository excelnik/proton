const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const os = require('os')
const fs = require('fs')

// נתיב ה-DB בתיקיית המשתמש
const DB_PATH = path.join(os.homedir(), 'AppData', 'Roaming', 'proton')
process.env.PROTON_DB_PATH = DB_PATH

let mainWindow

function createWindow() {
  mainWindow = new BrowserWindow({
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

const { dialog } = require('electron')

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
const { app, BrowserWindow } = require('electron')
const path = require('path')
const os = require('os')

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
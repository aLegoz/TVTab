import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { initSqlEngine } from '../db/db'
import { migrateIfNeeded } from '../db/companies'
import { registerCompanyHandlers } from '../db/handlers/companies'
import { registerEmployeeHandlers } from '../db/handlers/employees'
import { registerTimesheetHandlers } from '../db/handlers/timesheet'
import { registerSalaryHandlers } from '../db/handlers/salary'
import { registerExportHandlers } from '../db/handlers/export'
import { registerSettingsHandlers } from '../db/handlers/settings'
import { registerHolidayHandlers } from '../db/handlers/holidays'
import { registerMonthSettingsHandlers } from '../db/handlers/monthSettings'

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow.show())

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.tvtab')
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  await initSqlEngine()
  migrateIfNeeded()

  registerCompanyHandlers(ipcMain)
  registerEmployeeHandlers(ipcMain)
  registerTimesheetHandlers(ipcMain)
  registerSalaryHandlers(ipcMain)
  registerExportHandlers(ipcMain)
  registerSettingsHandlers(ipcMain)
  registerHolidayHandlers(ipcMain)
  registerMonthSettingsHandlers(ipcMain)

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

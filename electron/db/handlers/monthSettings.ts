import { IpcMain } from 'electron'
import { get, run } from '../db'

export function registerMonthSettingsHandlers(ipc: IpcMain): void {
  ipc.handle('monthSettings:get', (_e, year: number, month: number, key: string) => {
    const row = get<{ value: string }>(
      'SELECT value FROM month_settings WHERE year=? AND month=? AND key=?',
      [year, month, key]
    )
    return row?.value ?? null
  })

  ipc.handle('monthSettings:set', (_e, year: number, month: number, key: string, value: string) => {
    run(
      'INSERT OR REPLACE INTO month_settings (year, month, key, value) VALUES (?,?,?,?)',
      [year, month, key, value]
    )
    return true
  })
}

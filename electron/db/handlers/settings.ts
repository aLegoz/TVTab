import { IpcMain } from 'electron'
import { all, get, run } from '../db'

export function registerSettingsHandlers(ipc: IpcMain): void {
  ipc.handle('settings:get', (_e, key: string) => {
    return (get('SELECT value FROM settings WHERE key=?', [key]) as any)?.value ?? null
  })

  ipc.handle('settings:set', (_e, key: string, value: string) => {
    run(
      "INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      [key, value]
    )
  })

  ipc.handle('settings:getAll', () => {
    const rows = all('SELECT key, value FROM settings') as any[]
    return Object.fromEntries(rows.map((r) => [r.key, r.value]))
  })
}

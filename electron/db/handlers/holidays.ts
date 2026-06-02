import { IpcMain } from 'electron'
import { all, run, get, appendAudit } from '../db'

export function registerHolidayHandlers(ipc: IpcMain): void {
  ipc.handle('holidays:list', (_e, year: number, month: number) => {
    const prefix = `${year}-${String(month).padStart(2, '0')}`
    const rows = all('SELECT date FROM holidays WHERE date LIKE ? ORDER BY date', [prefix + '%']) as any[]
    return rows.map((r) => r.date as string)
  })

  ipc.handle('holidays:toggle', (_e, date: string) => {
    const existing = get('SELECT id FROM holidays WHERE date = ?', [date]) as any
    if (existing) {
      run('DELETE FROM holidays WHERE date = ?', [date])
      appendAudit('holiday.toggle', { date, active: false })
      return { active: false }
    } else {
      run('INSERT INTO holidays (date) VALUES (?)', [date])
      appendAudit('holiday.toggle', { date, active: true })
      return { active: true }
    }
  })

  ipc.handle('workdays:list', (_e, year: number, month: number) => {
    const prefix = `${year}-${String(month).padStart(2, '0')}`
    const rows = all('SELECT date FROM workdays WHERE date LIKE ? ORDER BY date', [prefix + '%']) as any[]
    return rows.map((r) => r.date as string)
  })

  ipc.handle('workdays:toggle', (_e, date: string) => {
    const existing = get('SELECT id FROM workdays WHERE date = ?', [date]) as any
    if (existing) {
      run('DELETE FROM workdays WHERE date = ?', [date])
      appendAudit('workday.toggle', { date, active: false })
      return { active: false }
    } else {
      run('INSERT INTO workdays (date) VALUES (?)', [date])
      appendAudit('workday.toggle', { date, active: true })
      return { active: true }
    }
  })
}

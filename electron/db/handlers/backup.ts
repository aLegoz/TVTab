import { IpcMain, dialog } from 'electron'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { all, get, run, runNoSave, transaction, auditLogPath, getCurrentCompanyId } from '../db'

function exportData(): Record<string, any> {
  return {
    version: '1.4.0',
    exportedAt: new Date().toISOString(),
    departments: all('SELECT * FROM departments'),
    employees: all('SELECT * FROM employees'),
    salaryHistory: all('SELECT * FROM salary_history'),
    timesheetRecords: all('SELECT * FROM timesheet_records'),
    holidays: (all('SELECT date FROM holidays') as any[]).map((r) => r.date),
    workdays: (all('SELECT date FROM workdays') as any[]).map((r) => r.date),
    monthSettings: all('SELECT * FROM month_settings'),
    settings: all('SELECT * FROM settings'),
  }
}

function importData(data: Record<string, any>): void {
  transaction(() => {
    runNoSave('DELETE FROM timesheet_records')
    runNoSave('DELETE FROM salary_history')
    runNoSave('DELETE FROM employees')
    runNoSave('DELETE FROM departments')
    runNoSave('DELETE FROM holidays')
    runNoSave('DELETE FROM workdays')
    runNoSave('DELETE FROM month_settings')
    try { runNoSave('DELETE FROM sqlite_sequence') } catch {}

    for (const d of data.departments ?? [])
      runNoSave('INSERT INTO departments (id,name) VALUES (?,?)', [d.id, d.name])
    for (const e of data.employees ?? [])
      runNoSave('INSERT INTO employees (id,full_name,position,department_id,rate_type,rate,hired_date,is_active) VALUES (?,?,?,?,?,?,?,?)',
        [e.id, e.full_name, e.position, e.department_id, e.rate_type, e.rate, e.hired_date, e.is_active])
    for (const s of data.salaryHistory ?? [])
      runNoSave('INSERT INTO salary_history (id,employee_id,effective_from,rate_type,rate,note) VALUES (?,?,?,?,?,?)',
        [s.id, s.employee_id, s.effective_from, s.rate_type, s.rate, s.note ?? ''])
    for (const r of data.timesheetRecords ?? [])
      runNoSave('INSERT INTO timesheet_records (id,employee_id,date,code,hours,arrival_time,departure_time,overtime_coeff) VALUES (?,?,?,?,?,?,?,?)',
        [r.id, r.employee_id, r.date, r.code, r.hours, r.arrival_time ?? null, r.departure_time ?? null, r.overtime_coeff ?? null])
    for (const date of data.holidays ?? [])
      runNoSave('INSERT OR IGNORE INTO holidays (date) VALUES (?)', [date])
    for (const date of data.workdays ?? [])
      runNoSave('INSERT OR IGNORE INTO workdays (date) VALUES (?)', [date])
    for (const ms of data.monthSettings ?? [])
      runNoSave('INSERT OR REPLACE INTO month_settings (year,month,key,value) VALUES (?,?,?,?)',
        [ms.year, ms.month, ms.key, ms.value])
    for (const s of data.settings ?? [])
      runNoSave('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)', [s.key, s.value])
  })
}

function applyAuditEntry(entry: any): void {
  const { action, data: d } = entry
  switch (action) {
    case 'timesheet.save':
      runNoSave(`INSERT INTO timesheet_records (employee_id,date,code,hours,arrival_time,departure_time,overtime_coeff)
        VALUES (?,?,?,?,?,?,?)
        ON CONFLICT(employee_id,date) DO UPDATE SET code=excluded.code,hours=excluded.hours,
        arrival_time=excluded.arrival_time,departure_time=excluded.departure_time,overtime_coeff=excluded.overtime_coeff`,
        [d.employeeId, d.date, d.code, d.hours, d.arrivalTime ?? null, d.departureTime ?? null, d.overtimeCoeff ?? null])
      break
    case 'timesheet.delete':
      runNoSave('DELETE FROM timesheet_records WHERE employee_id=? AND date=?', [d.employeeId, d.date])
      break
    case 'department.create':
      runNoSave('INSERT OR IGNORE INTO departments (id,name) VALUES (?,?)', [d.id, d.name])
      break
    case 'department.delete':
      runNoSave('DELETE FROM departments WHERE id=?', [d.id])
      break
    case 'employee.create':
      runNoSave('INSERT OR IGNORE INTO employees (id,full_name,position,department_id,rate_type,rate,hired_date,is_active) VALUES (?,?,?,?,?,?,?,1)',
        [d.id, d.fullName, d.position || '', d.departmentId ?? null, d.rateType, d.rate, d.hiredDate ?? null])
      break
    case 'employee.update':
      runNoSave('UPDATE employees SET full_name=?,position=?,department_id=?,rate_type=?,rate=?,hired_date=?,is_active=? WHERE id=?',
        [d.fullName, d.position || '', d.departmentId ?? null, d.rateType, d.rate, d.hiredDate ?? null, d.isActive ? 1 : 0, d.id])
      break
    case 'employee.deactivate':
      runNoSave('UPDATE employees SET is_active=0 WHERE id=?', [d.id])
      break
    case 'salaryHistory.add':
      runNoSave('INSERT OR REPLACE INTO salary_history (id,employee_id,effective_from,rate_type,rate,note) VALUES (?,?,?,?,?,?)',
        [d.id, d.employeeId, d.effectiveFrom, d.rateType, d.rate, d.note ?? ''])
      break
    case 'salaryHistory.delete':
      runNoSave('DELETE FROM salary_history WHERE id=?', [d.id])
      break
    case 'holiday.toggle':
      if (d.active) runNoSave('INSERT OR IGNORE INTO holidays (date) VALUES (?)', [d.date])
      else runNoSave('DELETE FROM holidays WHERE date=?', [d.date])
      break
    case 'workday.toggle':
      if (d.active) runNoSave('INSERT OR IGNORE INTO workdays (date) VALUES (?)', [d.date])
      else runNoSave('DELETE FROM workdays WHERE date=?', [d.date])
      break
    case 'monthSettings.set':
      runNoSave('INSERT OR REPLACE INTO month_settings (year,month,key,value) VALUES (?,?,?,?)',
        [d.year, d.month, d.key, d.value])
      break
  }
}

function restoreFromAudit(logPath: string): { restored: number; errors: number } {
  if (!existsSync(logPath)) throw new Error('Audit log not found: ' + logPath)
  const lines = readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean)
  const entries = lines.map((l) => JSON.parse(l))
  let restored = 0
  let errors = 0
  transaction(() => {
    runNoSave('DELETE FROM timesheet_records')
    runNoSave('DELETE FROM salary_history')
    runNoSave('DELETE FROM employees')
    runNoSave('DELETE FROM departments')
    runNoSave('DELETE FROM holidays')
    runNoSave('DELETE FROM workdays')
    runNoSave('DELETE FROM month_settings')
    try { runNoSave('DELETE FROM sqlite_sequence') } catch {}
    for (const entry of entries) {
      try { applyAuditEntry(entry); restored++ } catch { errors++ }
    }
  })
  return { restored, errors }
}

export function registerBackupHandlers(ipc: IpcMain): void {
  ipc.handle('backup:getData', () => exportData())

  ipc.handle('backup:exportToFile', async () => {
    const result = await dialog.showSaveDialog({
      defaultPath: `tvtab-backup-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON Backup', extensions: ['json'] }]
    })
    if (result.canceled || !result.filePath) return null
    const data = exportData()
    writeFileSync(result.filePath, JSON.stringify(data, null, 2), 'utf-8')
    return result.filePath
  })

  ipc.handle('backup:importData', (_e, data: Record<string, any>) => {
    importData(data)
    return { ok: true }
  })

  ipc.handle('backup:importFromFile', async () => {
    const result = await dialog.showOpenDialog({
      filters: [{ name: 'JSON Backup', extensions: ['json'] }],
      properties: ['openFile']
    })
    if (result.canceled || !result.filePaths[0]) return { ok: false, reason: 'cancelled' }
    const raw = readFileSync(result.filePaths[0], 'utf-8')
    importData(JSON.parse(raw))
    return { ok: true }
  })

  ipc.handle('backup:getAuditLogPath', () => {
    const id = getCurrentCompanyId()
    if (!id) return null
    return auditLogPath()
  })

  ipc.handle('backup:restoreFromAudit', () => {
    const logPath = auditLogPath()
    return restoreFromAudit(logPath)
  })

  ipc.handle('backup:restoreFromAuditFile', async () => {
    const result = await dialog.showOpenDialog({
      filters: [{ name: 'Audit Log', extensions: ['jsonl', 'log', 'txt'] }],
      properties: ['openFile']
    })
    if (result.canceled || !result.filePaths[0]) return { ok: false, reason: 'cancelled' }
    const stats = restoreFromAudit(result.filePaths[0])
    return { ok: true, ...stats }
  })
}

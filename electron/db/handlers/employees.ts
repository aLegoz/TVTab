import { IpcMain } from 'electron'
import { all, get, run, runNoSave, runTx, transaction, appendAudit } from '../db'

function syncCurrentRate(employeeId: number): void {
  const latest = get<any>(
    'SELECT rate_type, rate FROM salary_history WHERE employee_id=? ORDER BY effective_from DESC LIMIT 1',
    [employeeId]
  )
  if (latest) {
    runNoSave('UPDATE employees SET rate_type=?, rate=? WHERE id=?', [latest.rate_type, latest.rate, employeeId])
  }
}

export function registerEmployeeHandlers(ipc: IpcMain): void {
  ipc.handle('departments:list', () => {
    return all('SELECT * FROM departments ORDER BY name')
  })

  ipc.handle('departments:create', (_e, name: string) => {
    const id = run('INSERT INTO departments (name) VALUES (?)', [name])
    appendAudit('department.create', { id, name })
    return { id, name }
  })

  ipc.handle('departments:delete', (_e, id: number) => {
    run('DELETE FROM departments WHERE id = ?', [id])
    appendAudit('department.delete', { id })
  })

  ipc.handle('employees:list', () => {
    return all(`
      SELECT e.id, e.full_name, e.position, e.department_id, d.name AS department_name,
             e.rate_type, e.rate, e.hired_date, e.is_active
      FROM employees e
      LEFT JOIN departments d ON d.id = e.department_id
      ORDER BY e.full_name
    `)
  })

  ipc.handle('employees:create', (_e, data: {
    fullName: string; position: string; departmentId: number | null
    rateType: string; rate: number; hiredDate: string
  }) => {
    const effectiveFrom = data.hiredDate || '2000-01-01'
    let id!: number
    let histId = 0
    transaction(() => {
      id = runTx(
        'INSERT INTO employees (full_name, position, department_id, rate_type, rate, hired_date) VALUES (?,?,?,?,?,?)',
        [data.fullName, data.position, data.departmentId ?? null, data.rateType, data.rate, data.hiredDate]
      )
      histId = runTx(
        'INSERT OR IGNORE INTO salary_history (employee_id, effective_from, rate_type, rate) VALUES (?,?,?,?)',
        [id, effectiveFrom, data.rateType, data.rate]
      )
    })
    appendAudit('employee.create', { id, fullName: data.fullName, position: data.position, departmentId: data.departmentId, rateType: data.rateType, rate: data.rate, hiredDate: data.hiredDate })
    if (histId > 0) appendAudit('salaryHistory.add', { id: histId, employeeId: id, effectiveFrom, rateType: data.rateType, rate: data.rate, note: '' })
    return { id, ...data }
  })

  ipc.handle('employees:update', (_e, id: number, data: {
    fullName: string; position: string; departmentId: number | null
    rateType: string; rate: number; hiredDate: string; isActive: boolean
  }) => {
    transaction(() => {
      runNoSave(
        'UPDATE employees SET full_name=?,position=?,department_id=?,hired_date=?,is_active=? WHERE id=?',
        [data.fullName, data.position, data.departmentId ?? null, data.hiredDate, data.isActive ? 1 : 0, id]
      )
    })
    appendAudit('employee.update', { id, ...data })
    return { id, ...data }
  })

  ipc.handle('employees:delete', (_e, id: number) => {
    run('UPDATE employees SET is_active=0 WHERE id=?', [id])
    appendAudit('employee.deactivate', { id })
  })

  // --- Salary history ---

  ipc.handle('salaryHistory:list', (_e, employeeId: number) => {
    return all(
      'SELECT * FROM salary_history WHERE employee_id=? ORDER BY effective_from DESC',
      [employeeId]
    )
  })

  ipc.handle('salaryHistory:add', (_e, data: {
    employeeId: number; effectiveFrom: string; rateType: string; rate: number; note: string
  }) => {
    let id!: number
    transaction(() => {
      id = runTx(
        'INSERT OR REPLACE INTO salary_history (employee_id, effective_from, rate_type, rate, note) VALUES (?,?,?,?,?)',
        [data.employeeId, data.effectiveFrom, data.rateType, data.rate, data.note ?? '']
      )
      syncCurrentRate(data.employeeId)
    })
    appendAudit('salaryHistory.add', { id, ...data })
    return { id, ...data }
  })

  ipc.handle('salaryHistory:delete', (_e, id: number, employeeId: number) => {
    transaction(() => {
      runNoSave('DELETE FROM salary_history WHERE id=?', [id])
      syncCurrentRate(employeeId)
    })
    appendAudit('salaryHistory.delete', { id, employeeId })
  })
}

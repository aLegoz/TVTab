import { IpcMain } from 'electron'
import { all, get } from '../db'

function getSettingVal(key: string, def: string): string {
  return (get(`SELECT value FROM settings WHERE key='${key}'`) as any)?.value ?? def
}

function getWorkingDaysInMonth(
  year: number,
  month: number,
  holidayDates: string[],
  workdayDates: string[]
): number {
  const daysInMonth = new Date(year, month, 0).getDate()
  const prefix = `${year}-${String(month).padStart(2, '0')}`
  const holidaySet = new Set(holidayDates)
  const workdaySet = new Set(workdayDates)
  let count = 0
  for (let d = 1; d <= daysInMonth; d++) {
    const dow = new Date(year, month - 1, d).getDay()
    const dateStr = `${prefix}-${String(d).padStart(2, '0')}`
    const weekend = dow === 0 || dow === 6
    if (workdaySet.has(dateStr)) count++
    else if (!weekend && !holidaySet.has(dateStr)) count++
  }
  return count
}

interface OvertimeResult {
  regularHours: number
  overtimeHours: number
  salary: number
}

// Переработка считается как превышение МЕСЯЧНОЙ нормы часов, не дневной
function calcEmployeeSalary(
  workedRecs: any[],
  derivedHourlyRate: number,
  normHours: number,
  globalOvertimeCoeff: number
): OvertimeResult {
  const totalWorked = workedRecs.reduce((s: number, r: any) => s + r.hours, 0)
  const overtimeHours = Math.max(0, totalWorked - normHours)
  const regularHours = totalWorked - overtimeHours

  const salary = derivedHourlyRate * regularHours + derivedHourlyRate * globalOvertimeCoeff * overtimeHours

  return {
    regularHours: Math.round(regularHours * 100) / 100,
    overtimeHours: Math.round(overtimeHours * 100) / 100,
    salary: Math.round(salary * 100) / 100,
  }
}

export function registerSalaryHandlers(ipc: IpcMain): void {

  ipc.handle('salary:detail', (_e, employeeId: number, year: number, month: number) => {
    const prefix = `${year}-${String(month).padStart(2, '0')}`
    const monthStart = `${prefix}-01`

    const holidayRows = all('SELECT date FROM holidays WHERE date LIKE ?', [prefix + '%']) as any[]
    const workdayRows = all('SELECT date FROM workdays WHERE date LIKE ?', [prefix + '%']) as any[]
    const holidayDates = holidayRows.map((r) => r.date as string)
    const workdayDates = workdayRows.map((r) => r.date as string)
    const normDays = getWorkingDaysInMonth(year, month, holidayDates, workdayDates)
    const hoursPerDay = Number(getSettingVal('workHoursPerDay', '8'))
    const normHours = normDays * hoursPerDay
    const monthCoeffRow = get<{ value: string }>(
      'SELECT value FROM month_settings WHERE year=? AND month=? AND key=?',
      [year, month, 'overtimeCoeff']
    )
    const globalOvertimeCoeff = monthCoeffRow
      ? Number(monthCoeffRow.value)
      : Number(getSettingVal('overtimeCoeff', '1.5'))

    const emp = get<any>('SELECT id, full_name, position, rate_type, rate FROM employees WHERE id=?', [employeeId])
    if (!emp) return null

    const historyEntry = get<any>(
      'SELECT rate_type, rate FROM salary_history WHERE employee_id=? AND effective_from<=? ORDER BY effective_from DESC LIMIT 1',
      [employeeId, monthStart]
    )
    const rateType: string = historyEntry?.rate_type ?? emp.rate_type
    const rate: number = historyEntry?.rate ?? emp.rate

    const vacationCoeffRow = get<{ value: string }>(
      'SELECT value FROM month_settings WHERE year=? AND month=? AND key=?',
      [year, month, 'vacationCoeff']
    )
    const vacationCoeff = vacationCoeffRow ? Number(vacationCoeffRow.value) : 1

    const sickCoeffRow = get<{ value: string }>(
      'SELECT value FROM month_settings WHERE year=? AND month=? AND key=?',
      [year, month, 'sickCoeff']
    )
    const sickCoeff = sickCoeffRow ? Number(sickCoeffRow.value) : 0

    const rows = all<any>('SELECT * FROM timesheet_records WHERE employee_id=? AND date LIKE ? ORDER BY date',
      [employeeId, prefix + '%'])

    const workedRecs = rows.filter((r: any) => r.code === 'Я')
    const vacationDays = rows.filter((r: any) => r.code === 'О').length
    const sickDays = rows.filter((r: any) => r.code === 'Б').length

    const derivedHourlyRate = rateType === 'hourly' ? rate : normHours > 0 ? rate / normHours : 0

    const { regularHours, overtimeHours, salary: workedSalary } = calcEmployeeSalary(
      workedRecs, derivedHourlyRate, normHours, globalOvertimeCoeff
    )

    const perDayRate = derivedHourlyRate * hoursPerDay
    const vacationPay = Math.round(perDayRate * vacationDays * vacationCoeff * 100) / 100
    const sickPay = Math.round(perDayRate * sickDays * sickCoeff * 100) / 100
    const salary = Math.round((workedSalary + vacationPay + sickPay) * 100) / 100

    const records = rows.map((r: any) => ({
      date: r.date,
      code: r.code,
      arrivalTime: r.arrival_time ?? undefined,
      departureTime: r.departure_time ?? undefined,
      hours: r.hours,
      regularHours: r.hours,
      overtimeHours: 0,
      overtimeCoeff: globalOvertimeCoeff,
    }))

    const regularSalary = Math.round(derivedHourlyRate * regularHours * 100) / 100
    const overtimeSalary = Math.round((workedSalary - regularSalary) * 100) / 100

    return {
      employee: { id: emp.id, fullName: emp.full_name, position: emp.position },
      year, month, normDays, normHours, hoursPerDay,
      effectiveRate: rate,
      effectiveRateType: rateType,
      derivedHourlyRate: Math.round(derivedHourlyRate * 100) / 100,
      globalOvertimeCoeff, vacationCoeff, sickCoeff,
      records,
      workedDays: workedRecs.length,
      regularHours,
      overtimeHours,
      workedHours: Math.round((regularHours + overtimeHours) * 100) / 100,
      vacationDays, sickDays, vacationPay, sickPay,
      regularSalary,
      overtimeSalary,
      salary,
    }
  })

  ipc.handle('salary:summary', (_e, year: number, month: number) => {
    const prefix = `${year}-${String(month).padStart(2, '0')}`
    const monthStart = `${prefix}-01`

    const holidayRows = all('SELECT date FROM holidays WHERE date LIKE ?', [prefix + '%']) as any[]
    const workdayRows = all('SELECT date FROM workdays WHERE date LIKE ?', [prefix + '%']) as any[]
    const holidayDates = holidayRows.map((r) => r.date as string)
    const workdayDates = workdayRows.map((r) => r.date as string)
    const normDays = getWorkingDaysInMonth(year, month, holidayDates, workdayDates)
    const hoursPerDay = Number(getSettingVal('workHoursPerDay', '8'))
    const normHours = normDays * hoursPerDay
    const monthCoeffRowS = get<{ value: string }>(
      'SELECT value FROM month_settings WHERE year=? AND month=? AND key=?',
      [year, month, 'overtimeCoeff']
    )
    const globalOvertimeCoeff = monthCoeffRowS
      ? Number(monthCoeffRowS.value)
      : Number(getSettingVal('overtimeCoeff', '1.5'))

    const employees = all(`
      SELECT e.id, e.full_name, e.position, e.department_id, d.name AS department_name,
             e.rate_type, e.rate, e.hired_date, e.is_active
      FROM employees e LEFT JOIN departments d ON d.id = e.department_id
      WHERE e.is_active = 1 ORDER BY e.full_name
    `) as any[]

    const records = all('SELECT * FROM timesheet_records WHERE date LIKE ?', [prefix + '%']) as any[]

    return employees.map((emp) => {
      const historyEntry = get<any>(
        'SELECT rate_type, rate FROM salary_history WHERE employee_id=? AND effective_from<=? ORDER BY effective_from DESC LIMIT 1',
        [emp.id, monthStart]
      )
      const rateType: string = historyEntry?.rate_type ?? emp.rate_type
      const rate: number = historyEntry?.rate ?? emp.rate

      const vacationCoeffRowS = get<{ value: string }>(
        'SELECT value FROM month_settings WHERE year=? AND month=? AND key=?',
        [year, month, 'vacationCoeff']
      )
      const vacationCoeff = vacationCoeffRowS ? Number(vacationCoeffRowS.value) : 1

      const sickCoeffRowS = get<{ value: string }>(
        'SELECT value FROM month_settings WHERE year=? AND month=? AND key=?',
        [year, month, 'sickCoeff']
      )
      const sickCoeff = sickCoeffRowS ? Number(sickCoeffRowS.value) : 0

      const empRecords = records.filter((r: any) => r.employee_id === emp.id)
      const workedRecs = empRecords.filter((r: any) => r.code === 'Я')
      const vacationDays = empRecords.filter((r: any) => r.code === 'О').length
      const sickDays = empRecords.filter((r: any) => r.code === 'Б').length

      const derivedHourlyRate = rateType === 'hourly' ? rate : normHours > 0 ? rate / normHours : 0

      const { regularHours, overtimeHours, salary: workedSalary } = calcEmployeeSalary(
        workedRecs, derivedHourlyRate, normHours, globalOvertimeCoeff
      )

      const perDayRate = derivedHourlyRate * hoursPerDay
      const vacationPay = Math.round(perDayRate * vacationDays * vacationCoeff * 100) / 100
      const sickPay = Math.round(perDayRate * sickDays * sickCoeff * 100) / 100
      const salary = Math.round((workedSalary + vacationPay + sickPay) * 100) / 100

      return {
        employee: {
          id: emp.id, fullName: emp.full_name, position: emp.position,
          departmentId: emp.department_id, departmentName: emp.department_name,
          rateType: emp.rate_type, rate: emp.rate, hiredDate: emp.hired_date,
          isActive: emp.is_active === 1
        },
        normDays,
        effectiveRate: rate,
        effectiveRateType: rateType,
        derivedHourlyRate: Math.round(derivedHourlyRate * 100) / 100,
        workedDays: workedRecs.length,
        workedHours: Math.round((regularHours + overtimeHours) * 100) / 100,
        overtimeHours,
        vacationDays, sickDays, vacationPay, sickPay, salary,
      }
    })
  })
}

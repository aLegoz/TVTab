import { IpcMain } from 'electron'
import { all, run, runNoSave, transaction, get } from '../db'

function toMins(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

function calcWorkedHours(
  arrival: string,
  departure: string,
  lunchStart: string,
  lunchEnd: string
): number {
  const arr = toMins(arrival)
  const dep = toMins(departure)
  if (dep <= arr) return 0
  const lunchOverlap = Math.max(0, Math.min(dep, toMins(lunchEnd)) - Math.max(arr, toMins(lunchStart)))
  return Math.round((dep - arr - lunchOverlap) / 60 * 100) / 100
}

function getSchedule() {
  const s = (key: string, def: string) =>
    (get(`SELECT value FROM settings WHERE key='${key}'`) as any)?.value ?? def
  return {
    lunchStart: s('scheduleLunchStart', '12:30'),
    lunchEnd:   s('scheduleLunchEnd',   '13:00'),
  }
}

export function registerTimesheetHandlers(ipc: IpcMain): void {
  ipc.handle('timesheet:get', (_e, year: number, month: number) => {
    const prefix = `${year}-${String(month).padStart(2, '0')}`
    return all('SELECT * FROM timesheet_records WHERE date LIKE ? ORDER BY employee_id, date', [prefix + '%'])
  })

  ipc.handle('timesheet:saveRecord', (_e, data: {
    employeeId: number
    date: string
    code: string
    hours: number
    arrivalTime?: string
    departureTime?: string
    overtimeCoeff?: number
  }) => {
    let hours = data.hours
    if (data.arrivalTime && data.departureTime) {
      const { lunchStart, lunchEnd } = getSchedule()
      hours = calcWorkedHours(data.arrivalTime, data.departureTime, lunchStart, lunchEnd)
    }
    run(`
      INSERT INTO timesheet_records (employee_id, date, code, hours, arrival_time, departure_time, overtime_coeff)
      VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(employee_id, date) DO UPDATE SET
        code=excluded.code, hours=excluded.hours,
        arrival_time=excluded.arrival_time, departure_time=excluded.departure_time,
        overtime_coeff=excluded.overtime_coeff
    `, [data.employeeId, data.date, data.code, hours,
        data.arrivalTime ?? null, data.departureTime ?? null,
        data.overtimeCoeff ?? null])
  })

  ipc.handle('timesheet:deleteRecord', (_e, employeeId: number, date: string) => {
    run('DELETE FROM timesheet_records WHERE employee_id=? AND date=?', [employeeId, date])
  })

  ipc.handle('timesheet:bulkSave', (_e, records: Array<{
    employeeId: number; date: string; code: string; hours: number
    arrivalTime?: string; departureTime?: string
  }>) => {
    const { lunchStart, lunchEnd } = getSchedule()
    transaction(() => {
      for (const r of records) {
        let hours = r.hours
        if (r.arrivalTime && r.departureTime) {
          hours = calcWorkedHours(r.arrivalTime, r.departureTime, lunchStart, lunchEnd)
        }
        runNoSave(`
          INSERT INTO timesheet_records (employee_id, date, code, hours, arrival_time, departure_time)
          VALUES (?,?,?,?,?,?)
          ON CONFLICT(employee_id, date) DO UPDATE SET
            code=excluded.code, hours=excluded.hours,
            arrival_time=excluded.arrival_time, departure_time=excluded.departure_time
        `, [r.employeeId, r.date, r.code, hours, r.arrivalTime ?? null, r.departureTime ?? null])
      }
    })
  })
}

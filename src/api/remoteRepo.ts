import type { IRepository } from './IRepository'
import type {
  Department, Employee, TimesheetRecord,
  SalarySummary, SalaryDetail, AppSettings, SalaryHistoryEntry
} from '../types'
import type { Lang } from '../i18n/translations'

export class RemoteRepository implements IRepository {
  constructor(private baseUrl: string) {}

  private async req<T>(path: string, opts?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...opts
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`)
    return res.json()
  }

  listDepartments = () => this.req<Department[]>('/departments')
  createDepartment = (name: string) => this.req<Department>('/departments', { method: 'POST', body: JSON.stringify({ name }) })
  deleteDepartment = (id: number) => this.req<void>(`/departments/${id}`, { method: 'DELETE' })

  listEmployees = () => this.req<Employee[]>('/employees')
  createEmployee = (data: any) => this.req<Employee>('/employees', { method: 'POST', body: JSON.stringify(data) })
  updateEmployee = (id: number, data: any) => this.req<Employee>(`/employees/${id}`, { method: 'PUT', body: JSON.stringify(data) })
  deleteEmployee = (id: number) => this.req<void>(`/employees/${id}`, { method: 'DELETE' })

  getTimesheet = (year: number, month: number) => this.req<TimesheetRecord[]>(`/timesheet/${year}/${month}`)
  saveTimesheetRecord = (data: any) => this.req<void>('/timesheet/record', { method: 'POST', body: JSON.stringify(data) })
  deleteTimesheetRecord = (employeeId: number, date: string) => this.req<void>(`/timesheet/record/${employeeId}/${date}`, { method: 'DELETE' })
  bulkSaveTimesheet = (records: any[]) => this.req<void>('/timesheet/bulk', { method: 'POST', body: JSON.stringify(records) })

  getSalaryHistory = (employeeId: number) => this.req<SalaryHistoryEntry[]>(`/salary-history/${employeeId}`)
  addSalaryHistory = (data: any) => this.req<SalaryHistoryEntry>('/salary-history', { method: 'POST', body: JSON.stringify(data) })
  deleteSalaryHistory = (id: number, employeeId: number) => this.req<void>(`/salary-history/${id}?employeeId=${employeeId}`, { method: 'DELETE' })

  listHolidays = (year: number, month: number) => this.req<string[]>(`/holidays/${year}/${month}`)
  toggleHoliday = (date: string) => this.req<{ active: boolean }>('/holidays/toggle', { method: 'POST', body: JSON.stringify({ date }) })
  listWorkdays = (year: number, month: number) => this.req<string[]>(`/workdays/${year}/${month}`)
  toggleWorkday = (date: string) => this.req<{ active: boolean }>('/workdays/toggle', { method: 'POST', body: JSON.stringify({ date }) })

  getMonthOvertimeCoeff = (year: number, month: number) =>
    this.req<number | null>(`/month-settings/${year}/${month}/overtimeCoeff`)
  setMonthOvertimeCoeff = (year: number, month: number, coeff: number) =>
    this.req<void>(`/month-settings/${year}/${month}/overtimeCoeff`, {
      method: 'PUT', body: JSON.stringify({ value: coeff })
    })
  getMonthVacationCoeff = (year: number, month: number) =>
    this.req<number | null>(`/month-settings/${year}/${month}/vacationCoeff`)
  setMonthVacationCoeff = (year: number, month: number, coeff: number) =>
    this.req<void>(`/month-settings/${year}/${month}/vacationCoeff`, {
      method: 'PUT', body: JSON.stringify({ value: coeff })
    })
  getMonthSickCoeff = (year: number, month: number) =>
    this.req<number | null>(`/month-settings/${year}/${month}/sickCoeff`)
  setMonthSickCoeff = (year: number, month: number, coeff: number) =>
    this.req<void>(`/month-settings/${year}/${month}/sickCoeff`, {
      method: 'PUT', body: JSON.stringify({ value: coeff })
    })

  getSalarySummary = (year: number, month: number) => this.req<SalarySummary[]>(`/salary/${year}/${month}`)
  getSalaryDetail = (employeeId: number, year: number, month: number) =>
    this.req<SalaryDetail | null>(`/salary/${year}/${month}/detail/${employeeId}`)

  async exportToExcel(year: number, month: number, lang: Lang): Promise<string | null> {
    window.open(`${this.baseUrl}/export/excel/${year}/${month}?lang=${lang}`)
    return null
  }
  async exportToPdf(year: number, month: number, lang: Lang): Promise<string | null> {
    window.open(`${this.baseUrl}/export/pdf/${year}/${month}?lang=${lang}`)
    return null
  }
  async exportDetailToPdf(employeeId: number, year: number, month: number, colorMode: 'color' | 'bw', lang: Lang): Promise<string | null> {
    window.open(`${this.baseUrl}/export/detail-pdf/${year}/${month}/${employeeId}?colorMode=${colorMode}&lang=${lang}`)
    return null
  }

  async getSettings(): Promise<AppSettings> {
    return {
      mode: 'remote',
      serverUrl: this.baseUrl,
      workHoursPerDay: 8,
      scheduleStart: '08:30',
      scheduleLunchStart: '12:30',
      scheduleLunchEnd: '13:00',
      scheduleEnd: '17:00',
      overtimeCoeff: 1.5,
    }
  }
  async setSetting(_key: keyof AppSettings, _value: string): Promise<void> {
    return window.api.settings.set(_key, _value)
  }
}

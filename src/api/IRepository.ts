import type { Department, Employee, SalaryHistoryEntry, TimesheetRecord, SalarySummary, SalaryDetail, AppSettings } from '../types'
import type { Lang } from '../i18n/translations'

export interface IRepository {
  // Departments
  listDepartments(): Promise<Department[]>
  createDepartment(name: string): Promise<Department>
  deleteDepartment(id: number): Promise<void>

  // Employees
  listEmployees(): Promise<Employee[]>
  createEmployee(data: Omit<Employee, 'id' | 'isActive' | 'departmentName'>): Promise<Employee>
  updateEmployee(id: number, data: Omit<Employee, 'id' | 'departmentName'>): Promise<Employee>
  deleteEmployee(id: number): Promise<void>

  // Timesheet
  getTimesheet(year: number, month: number): Promise<TimesheetRecord[]>
  saveTimesheetRecord(data: Omit<TimesheetRecord, 'id'>): Promise<void>
  deleteTimesheetRecord(employeeId: number, date: string): Promise<void>
  bulkSaveTimesheet(records: Omit<TimesheetRecord, 'id'>[]): Promise<void>

  // Salary history
  getSalaryHistory(employeeId: number): Promise<SalaryHistoryEntry[]>
  addSalaryHistory(data: Omit<SalaryHistoryEntry, 'id'>): Promise<SalaryHistoryEntry>
  deleteSalaryHistory(id: number, employeeId: number): Promise<void>

  // Holidays / workdays
  listHolidays(year: number, month: number): Promise<string[]>
  toggleHoliday(date: string): Promise<{ active: boolean }>
  listWorkdays(year: number, month: number): Promise<string[]>
  toggleWorkday(date: string): Promise<{ active: boolean }>

  // Month-specific settings
  getMonthOvertimeCoeff(year: number, month: number): Promise<number | null>
  setMonthOvertimeCoeff(year: number, month: number, coeff: number): Promise<void>
  getMonthVacationCoeff(year: number, month: number): Promise<number | null>
  setMonthVacationCoeff(year: number, month: number, coeff: number): Promise<void>
  getMonthSickCoeff(year: number, month: number): Promise<number | null>
  setMonthSickCoeff(year: number, month: number, coeff: number): Promise<void>

  // Salary
  getSalarySummary(year: number, month: number): Promise<SalarySummary[]>
  getSalaryDetail(employeeId: number, year: number, month: number): Promise<SalaryDetail | null>
  setAdvance(employeeId: number, year: number, month: number, amount: number, givenDate: string): Promise<void>

  // Export (local only — remote opens browser download)
  exportToExcel(year: number, month: number, lang: Lang): Promise<string | null>
  exportToPdf(year: number, month: number, lang: Lang): Promise<string | null>
  exportDetailToPdf(employeeId: number, year: number, month: number, colorMode: 'color' | 'bw', lang: Lang): Promise<string | null>
  exportSalaryToExcel(year: number, month: number, lang: Lang): Promise<string | null>
  exportSalaryToPdf(year: number, month: number, lang: Lang): Promise<string | null>

  // Settings
  getSettings(): Promise<AppSettings>
  setSetting(key: keyof AppSettings, value: string): Promise<void>

  // Real-time sync (returns unsubscribe fn)
  subscribeToChanges(callback: () => void): () => void
}

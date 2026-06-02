import type { IRepository } from './IRepository'
import type { Department, Employee, SalaryHistoryEntry, TimesheetRecord, SalarySummary, AppSettings } from '../types'
import type { Lang } from '../i18n/translations'

function mapEmployee(raw: any): Employee {
  return {
    id: raw.id,
    fullName: raw.full_name,
    position: raw.position,
    departmentId: raw.department_id,
    departmentName: raw.department_name,
    rateType: raw.rate_type,
    rate: raw.rate,
    hiredDate: raw.hired_date,
    isActive: raw.is_active === 1 || raw.is_active === true
  }
}

export class LocalRepository implements IRepository {
  private get api() { return window.api }

  async listDepartments(): Promise<Department[]> {
    return this.api.departments.list()
  }

  async createDepartment(name: string): Promise<Department> {
    return this.api.departments.create(name)
  }

  async deleteDepartment(id: number): Promise<void> {
    return this.api.departments.delete(id)
  }

  async listEmployees(): Promise<Employee[]> {
    const rows = await this.api.employees.list()
    return rows.map(mapEmployee)
  }

  async createEmployee(data: Omit<Employee, 'id' | 'isActive' | 'departmentName'>): Promise<Employee> {
    const raw = await this.api.employees.create({
      fullName: data.fullName,
      position: data.position,
      departmentId: data.departmentId,
      rateType: data.rateType,
      rate: data.rate,
      hiredDate: data.hiredDate
    })
    return mapEmployee({ ...raw, full_name: data.fullName, position: data.position,
      department_id: data.departmentId, rate_type: data.rateType,
      rate: data.rate, hired_date: data.hiredDate, is_active: 1 })
  }

  async updateEmployee(id: number, data: Omit<Employee, 'id' | 'departmentName'>): Promise<Employee> {
    await this.api.employees.update(id, {
      fullName: data.fullName,
      position: data.position,
      departmentId: data.departmentId,
      rateType: data.rateType,
      rate: data.rate,
      hiredDate: data.hiredDate,
      isActive: data.isActive
    })
    return { id, ...data }
  }

  async deleteEmployee(id: number): Promise<void> {
    return this.api.employees.delete(id)
  }

  async getTimesheet(year: number, month: number): Promise<TimesheetRecord[]> {
    const rows = await this.api.timesheet.get(year, month)
    return rows.map((r: any) => ({
      id: r.id,
      employeeId: r.employee_id,
      date: r.date,
      code: r.code,
      hours: r.hours,
      arrivalTime: r.arrival_time ?? undefined,
      departureTime: r.departure_time ?? undefined,
      overtimeCoeff: r.overtime_coeff ?? undefined,
    }))
  }

  async saveTimesheetRecord(data: Omit<TimesheetRecord, 'id'> & { arrivalTime?: string; departureTime?: string }): Promise<void> {
    return this.api.timesheet.saveRecord({
      employeeId: data.employeeId,
      date: data.date,
      code: data.code,
      hours: data.hours,
      arrivalTime: data.arrivalTime,
      departureTime: data.departureTime,
      overtimeCoeff: data.overtimeCoeff,
    })
  }

  async deleteTimesheetRecord(employeeId: number, date: string): Promise<void> {
    return this.api.timesheet.deleteRecord(employeeId, date)
  }

  async bulkSaveTimesheet(records: Omit<TimesheetRecord, 'id'>[]): Promise<void> {
    return this.api.timesheet.bulkSave(records)
  }

  async getSalaryHistory(employeeId: number): Promise<SalaryHistoryEntry[]> {
    const rows = await this.api.salaryHistory.list(employeeId)
    return rows.map((r: any) => ({
      id: r.id,
      employeeId: r.employee_id,
      effectiveFrom: r.effective_from,
      rateType: r.rate_type,
      rate: r.rate,
      note: r.note ?? ''
    }))
  }

  async addSalaryHistory(data: Omit<SalaryHistoryEntry, 'id'>): Promise<SalaryHistoryEntry> {
    const raw = await this.api.salaryHistory.add({
      employeeId: data.employeeId,
      effectiveFrom: data.effectiveFrom,
      rateType: data.rateType,
      rate: data.rate,
      note: data.note
    })
    return { id: raw.id, ...data }
  }

  async deleteSalaryHistory(id: number, employeeId: number): Promise<void> {
    return this.api.salaryHistory.delete(id, employeeId)
  }

  async listHolidays(year: number, month: number): Promise<string[]> {
    return this.api.holidays.list(year, month)
  }

  async toggleHoliday(date: string): Promise<{ active: boolean }> {
    return this.api.holidays.toggle(date)
  }

  async listWorkdays(year: number, month: number): Promise<string[]> {
    return this.api.workdays.list(year, month)
  }

  async toggleWorkday(date: string): Promise<{ active: boolean }> {
    return this.api.workdays.toggle(date)
  }

  async getMonthOvertimeCoeff(year: number, month: number): Promise<number | null> {
    const val = await this.api.monthSettings.get(year, month, 'overtimeCoeff')
    return val !== null ? Number(val) : null
  }
  async setMonthOvertimeCoeff(year: number, month: number, coeff: number): Promise<void> {
    await this.api.monthSettings.set(year, month, 'overtimeCoeff', String(coeff))
  }
  async getMonthVacationCoeff(year: number, month: number): Promise<number | null> {
    const val = await this.api.monthSettings.get(year, month, 'vacationCoeff')
    return val !== null ? Number(val) : null
  }
  async setMonthVacationCoeff(year: number, month: number, coeff: number): Promise<void> {
    await this.api.monthSettings.set(year, month, 'vacationCoeff', String(coeff))
  }
  async getMonthSickCoeff(year: number, month: number): Promise<number | null> {
    const val = await this.api.monthSettings.get(year, month, 'sickCoeff')
    return val !== null ? Number(val) : null
  }
  async setMonthSickCoeff(year: number, month: number, coeff: number): Promise<void> {
    await this.api.monthSettings.set(year, month, 'sickCoeff', String(coeff))
  }

  async getSalarySummary(year: number, month: number): Promise<SalarySummary[]> {
    return this.api.salary.summary(year, month)
  }

  async getSalaryDetail(employeeId: number, year: number, month: number): Promise<SalaryDetail | null> {
    return this.api.salary.detail(employeeId, year, month)
  }

  async exportToExcel(year: number, month: number, lang: Lang): Promise<string | null> {
    return this.api.export.toExcel(year, month, lang)
  }

  async exportToPdf(year: number, month: number, lang: Lang): Promise<string | null> {
    return this.api.export.toPdf(year, month, lang)
  }

  async exportDetailToPdf(employeeId: number, year: number, month: number, colorMode: 'color' | 'bw', lang: Lang): Promise<string | null> {
    return this.api.export.detailToPdf(employeeId, year, month, colorMode, lang)
  }

  async exportSalaryToExcel(year: number, month: number, lang: Lang): Promise<string | null> {
    return this.api.export.salaryToExcel(year, month, lang)
  }

  async exportSalaryToPdf(year: number, month: number, lang: Lang): Promise<string | null> {
    return this.api.export.salaryToPdf(year, month, lang)
  }

  async getSettings(): Promise<AppSettings> {
    const all = await this.api.settings.getAll()
    return {
      mode: (all.mode as 'local' | 'remote') ?? 'local',
      serverUrl: all.serverUrl ?? '',
      workHoursPerDay: Number(all.workHoursPerDay ?? 8),
      scheduleStart: all.scheduleStart ?? '08:30',
      scheduleLunchStart: all.scheduleLunchStart ?? '12:30',
      scheduleLunchEnd: all.scheduleLunchEnd ?? '13:00',
      scheduleEnd: all.scheduleEnd ?? '17:00',
      overtimeCoeff: Number(all.overtimeCoeff ?? 1.5),
    }
  }

  async setSetting(key: keyof AppSettings, value: string): Promise<void> {
    return this.api.settings.set(key, value)
  }

  subscribeToChanges(_cb: () => void): () => void {
    return () => {}
  }
}

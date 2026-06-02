export interface Company {
  id: string
  name: string
  currency: string
  createdAt: string
  lastOpenedAt: string
}

export const CURRENCIES = [
  { symbol: '₴', label: 'Гривня (₴)' },
  { symbol: '$', label: 'Dollar ($)' },
  { symbol: '€', label: 'Euro (€)' },
  { symbol: '₸', label: 'Теңге (₸)' },
  { symbol: '₺', label: 'Lira (₺)' },
  { symbol: '£', label: 'Pound (£)' },
]

export type RateType = 'hourly' | 'monthly'

export type AttendanceCode = 'Я' | 'В' | 'О' | 'Б' | 'Н' | 'НН' | 'ОЗ'

export interface Department {
  id: number
  name: string
}

export interface Employee {
  id: number
  fullName: string
  position: string
  departmentId: number | null
  departmentName?: string
  rateType: RateType
  rate: number
  hiredDate: string
  isActive: boolean
}

export interface TimesheetRecord {
  id: number
  employeeId: number
  date: string  // YYYY-MM-DD
  code: AttendanceCode
  hours: number
  arrivalTime?: string   // HH:MM
  departureTime?: string // HH:MM
  overtimeCoeff?: number
}

export interface SalaryHistoryEntry {
  id: number
  employeeId: number
  effectiveFrom: string  // YYYY-MM-DD
  rateType: RateType
  rate: number
  note: string
}

export interface SalarySummary {
  employee: Employee
  normDays: number
  effectiveRate: number
  effectiveRateType: RateType
  derivedHourlyRate: number
  workedDays: number
  workedHours: number
  overtimeHours: number
  vacationDays: number
  sickDays: number
  vacationPay: number
  sickPay: number
  salary: number
  advance: number
  advanceDate: string
}

export interface DayRecord {
  date: string
  code: string
  arrivalTime?: string
  departureTime?: string
  hours: number
  regularHours: number
  overtimeHours: number
  overtimeCoeff: number
}

export interface SalaryDetail {
  employee: { id: number; fullName: string; position: string }
  year: number
  month: number
  normDays: number
  normHours: number
  hoursPerDay: number
  globalOvertimeCoeff: number
  vacationCoeff: number
  sickCoeff: number
  effectiveRate: number
  effectiveRateType: RateType
  derivedHourlyRate: number
  records: DayRecord[]
  workedDays: number
  regularHours: number
  overtimeHours: number
  workedHours: number
  vacationDays: number
  sickDays: number
  regularSalary: number
  overtimeSalary: number
  vacationPay: number
  sickPay: number
  salary: number
  advance: number
  advanceDate: string
}

export interface AppSettings {
  mode: 'local' | 'remote'
  serverUrl: string
  workHoursPerDay: number
  scheduleStart: string
  scheduleLunchStart: string
  scheduleLunchEnd: string
  scheduleEnd: string
  overtimeCoeff: number
}

export const ATTENDANCE_CODES: { code: AttendanceCode; label: string; color: string }[] = [
  { code: 'Я',  label: 'Явка',                  color: '#e6f4ff' },
  { code: 'В',  label: 'Выходной',              color: '#f5f5f5' },
  { code: 'О',  label: 'Отпуск',                color: '#fff7e6' },
  { code: 'Б',  label: 'Больничный',            color: '#fff1f0' },
  { code: 'ОЗ', label: 'Отпуск за свой счёт',  color: '#f0f0f0' },
  { code: 'Н',  label: 'Неявка (уваж.)',        color: '#fffbe6' },
  { code: 'НН', label: 'Прогул',               color: '#ffccc7' },
]

import { useState, useEffect, useCallback } from 'react'
import { Table, Select, Typography, Popover, Button, Space, Spin, message, Tooltip, TimePicker, InputNumber } from 'antd'
import { LeftOutlined, RightOutlined } from '@ant-design/icons'
import { useRepository } from '../../api/RepositoryContext'
import { useLang } from '../../i18n/LangContext'
import type { Employee, TimesheetRecord, AttendanceCode, AppSettings } from '../../types'
import { ATTENDANCE_CODES } from '../../types'
import dayjs from 'dayjs'

const { Title, Text } = Typography

type RecordMap = Map<string, TimesheetRecord>

function recordKey(employeeId: number, date: string) {
  return `${employeeId}_${date}`
}

function isWeekend(year: number, month: number, day: number): boolean {
  const dow = new Date(year, month - 1, day).getDay()
  return dow === 0 || dow === 6
}

function toMins(t: string) {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

function calcWorkedHours(arrival: string, departure: string, lunchStart: string, lunchEnd: string): number {
  const arr = toMins(arrival)
  const dep = toMins(departure)
  if (dep <= arr) return 0
  const overlap = Math.max(0, Math.min(dep, toMins(lunchEnd)) - Math.max(arr, toMins(lunchStart)))
  return Math.round((dep - arr - overlap) / 60 * 100) / 100
}

interface Schedule {
  start: string
  lunchStart: string
  lunchEnd: string
  end: string
}

const WORKING_CODES: AttendanceCode[] = ['Я', 'К']

export default function TimesheetPage() {
  const repo = useRepository()
  const { t } = useLang()
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [employees, setEmployees] = useState<Employee[]>([])
  const [recordMap, setRecordMap] = useState<RecordMap>(new Map())
  const [holidays, setHolidays] = useState<Set<string>>(new Set())
  const [workdays, setWorkdays] = useState<Set<string>>(new Set())
  const [schedule, setSchedule] = useState<Schedule>({
    start: '08:30', lunchStart: '12:30', lunchEnd: '13:00', end: '17:00'
  })
  const [globalOvertimeCoeff, setGlobalOvertimeCoeff] = useState(1.5)
  const [loading, setLoading] = useState(false)

  const daysInMonth = new Date(year, month, 0).getDate()
  const prefix = `${year}-${String(month).padStart(2, '0')}`

  const normDays = Array.from({ length: daysInMonth }, (_, i) => i + 1).filter((d) => {
    const date = `${prefix}-${String(d).padStart(2, '0')}`
    if (workdays.has(date)) return true
    if (isWeekend(year, month, d)) return false
    return !holidays.has(date)
  }).length

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [emps, records, holidayDates, workdayDates, settings] = await Promise.all([
        repo.listEmployees(),
        repo.getTimesheet(year, month),
        repo.listHolidays(year, month),
        repo.listWorkdays(year, month),
        repo.getSettings(),
      ])
      setEmployees(emps.filter((e) => e.isActive))
      const map = new Map<string, TimesheetRecord>()
      records.forEach((r) => map.set(recordKey(r.employeeId, r.date), r))
      setRecordMap(map)
      setHolidays(new Set(holidayDates))
      setWorkdays(new Set(workdayDates))
      const s = settings as AppSettings
      setSchedule({
        start: s.scheduleStart ?? '08:30',
        lunchStart: s.scheduleLunchStart ?? '12:30',
        lunchEnd: s.scheduleLunchEnd ?? '13:00',
        end: s.scheduleEnd ?? '17:00',
      })
      setGlobalOvertimeCoeff(s.overtimeCoeff ?? 1.5)
    } finally {
      setLoading(false)
    }
  }, [repo, year, month])

  useEffect(() => { load() }, [load])

  async function toggleHoliday(date: string) {
    try {
      const result = await repo.toggleHoliday(date)
      setHolidays((prev) => {
        const next = new Set(prev)
        if (result.active) next.add(date)
        else next.delete(date)
        return next
      })
    } catch (e: any) { message.error(e.message) }
  }

  async function toggleWorkday(date: string) {
    try {
      const result = await repo.toggleWorkday(date)
      setWorkdays((prev) => {
        const next = new Set(prev)
        if (result.active) next.add(date)
        else next.delete(date)
        return next
      })
    } catch (e: any) { message.error(e.message) }
  }

  async function handleCellChange(
    emp: Employee, day: number,
    code: AttendanceCode, hours: number,
    arrivalTime?: string, departureTime?: string,
    overtimeCoeff?: number
  ) {
    const date = `${prefix}-${String(day).padStart(2, '0')}`
    try {
      await repo.saveTimesheetRecord({ employeeId: emp.id, date, code, hours, arrivalTime, departureTime, overtimeCoeff })
      setRecordMap((prev) => {
        const next = new Map(prev)
        const existing = prev.get(recordKey(emp.id, date))
        next.set(recordKey(emp.id, date), {
          id: existing?.id ?? 0, employeeId: emp.id, date, code, hours,
          arrivalTime, departureTime, overtimeCoeff
        })
        return next
      })
    } catch (e: any) { message.error(e.message) }
  }

  function prevMonth() {
    if (month === 1) { setYear(y => y - 1); setMonth(12) }
    else setMonth(m => m - 1)
  }
  function nextMonth() {
    if (month === 12) { setYear(y => y + 1); setMonth(1) }
    else setMonth(m => m + 1)
  }

  const dayColumns = Array.from({ length: daysInMonth }, (_, i) => {
    const day = i + 1
    const weekend = isWeekend(year, month, day)
    const date = `${prefix}-${String(day).padStart(2, '0')}`
    const isHoliday = holidays.has(date)
    const isWorkday = workdays.has(date)
    const effectiveWeekend = (weekend || isHoliday) && !isWorkday
    const headerBg = isWorkday && weekend ? '#f6ffed' : isHoliday ? '#fff4e6' : weekend ? '#fafafa' : undefined
    return {
      title: (
        <div style={{ textAlign: 'center', lineHeight: 1.2, color: effectiveWeekend ? '#aaa' : undefined }}>
          <div style={{ fontWeight: 600 }}>{day}</div>
          <div style={{ fontSize: 9, color: effectiveWeekend ? '#ccc' : '#999' }}>
            {t.timesheet.weekdays[new Date(year, month - 1, day).getDay()]}
          </div>
        </div>
      ),
      key: `day_${day}`,
      width: 44,
      onHeaderCell: () => ({ style: { padding: '4px 2px', background: headerBg } }),
      onCell: () => ({ style: { padding: 0, background: headerBg } }),
      render: (_: any, emp: Employee) => {
        const rec = recordMap.get(recordKey(emp.id, date))
        const code = rec?.code
        const codeInfo = ATTENDANCE_CODES.find((c) => c.code === code)
        return (
          <CellEditor
            code={code}
            hours={rec?.hours ?? 0}
            arrivalTime={rec?.arrivalTime}
            departureTime={rec?.departureTime}
            overtimeCoeff={rec?.overtimeCoeff}
            weekend={effectiveWeekend}
            color={codeInfo?.color}
            schedule={schedule}
            globalOvertimeCoeff={globalOvertimeCoeff}
            onChange={(c, h, arr, dep, oc) => handleCellChange(emp, day, c, h, arr, dep, oc)}
          />
        )
      }
    }
  })

  const columns = [
    {
      title: t.employees.colNum, width: 42, fixed: 'left' as const,
      render: (_: any, __: any, i: number) => <span style={{ fontSize: 12 }}>{i + 1}</span>
    },
    {
      title: t.timesheet.colEmployee, dataIndex: 'fullName', key: 'name', width: 180, fixed: 'left' as const,
      render: (v: string) => <span style={{ fontSize: 12 }}>{v}</span>
    },
    ...dayColumns,
    {
      title: t.timesheet.colDays, key: 'days', width: 52, fixed: 'right' as const,
      render: (_: any, emp: Employee) => {
        let days = 0
        for (let d = 1; d <= daysInMonth; d++) {
          const rec = recordMap.get(recordKey(emp.id, `${prefix}-${String(d).padStart(2, '0')}`))
          if (rec && (rec.code === 'Я' || rec.code === 'К')) days++
        }
        return <span style={{ fontSize: 12, fontWeight: 600 }}>{days}</span>
      }
    },
    {
      title: t.timesheet.colHours, key: 'hours', width: 52, fixed: 'right' as const,
      render: (_: any, emp: Employee) => {
        let hours = 0
        for (let d = 1; d <= daysInMonth; d++) {
          const rec = recordMap.get(recordKey(emp.id, `${prefix}-${String(d).padStart(2, '0')}`))
          if (rec && (rec.code === 'Я' || rec.code === 'К')) hours += rec.hours
        }
        return <span style={{ fontSize: 12, fontWeight: 600 }}>{hours.toFixed(1).replace('.0', '')}</span>
      }
    }
  ]

  return (
    <Spin spinning={loading}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
        <Title level={4} style={{ margin: 0 }}>{t.timesheet.title}</Title>
        <Button icon={<LeftOutlined />} size="small" onClick={prevMonth} />
        <span style={{ fontWeight: 600, minWidth: 160, textAlign: 'center' }}>
          {t.timesheet.months[month - 1]} {year}
        </span>
        <Button icon={<RightOutlined />} size="small" onClick={nextMonth} />
      </div>

      {/* Панель официальных выходных / рабочих выходных */}
      <div style={{
        marginBottom: 12, padding: '8px 10px',
        background: '#fafafa', border: '1px solid #f0f0f0', borderRadius: 6,
        display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap'
      }}>
        <span style={{ fontSize: 12, color: '#666', whiteSpace: 'nowrap', marginRight: 2 }}>
          {t.timesheet.holidays}:
        </span>
        {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((day) => {
          const date = `${prefix}-${String(day).padStart(2, '0')}`
          const weekend = isWeekend(year, month, day)
          const isHoliday = holidays.has(date)
          const isWorkday = workdays.has(date)
          const wd = t.timesheet.weekdays[new Date(year, month - 1, day).getDay()]
          const bg = isWorkday && weekend ? '#52c41a' : isHoliday ? '#fa8c16' : weekend ? '#f0f0f0' : '#fff'
          const color = (isWorkday && weekend) || isHoliday ? '#fff' : weekend ? '#ccc' : '#555'
          const border = isWorkday && weekend ? '#52c41a' : isHoliday ? '#fa8c16' : '#d9d9d9'
          return (
            <Tooltip key={day} title={`${day} ${wd}`} mouseEnterDelay={0.5}>
              <div
                onClick={() => { if (weekend) toggleWorkday(date); else toggleHoliday(date) }}
                style={{
                  width: 26, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, fontWeight: 600, borderRadius: 3, cursor: 'pointer',
                  background: bg, color, border: `1px solid ${border}`,
                  userSelect: 'none', transition: 'all 0.15s',
                }}
              >
                {day}
              </div>
            </Tooltip>
          )
        })}
        <span style={{ fontSize: 11, color: '#888', marginLeft: 4, whiteSpace: 'nowrap' }}>
          {t.timesheet.normDays}: <b style={{ color: '#555' }}>{normDays}</b>
        </span>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <Table
          dataSource={employees}
          columns={columns}
          rowKey="id"
          size="small"
          pagination={false}
          scroll={{ x: 'max-content' }}
          bordered
        />
      </div>

      <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {ATTENDANCE_CODES.map((c) => (
          <span key={c.code}
            style={{ background: c.color, border: '1px solid #d9d9d9', borderRadius: 3, padding: '2px 6px', fontSize: 12 }}>
            <b>{c.code}</b> — {t.timesheet.attendance[c.code] ?? c.label}
          </span>
        ))}
      </div>
    </Spin>
  )
}

function CellEditor({
  code, hours, arrivalTime, departureTime, overtimeCoeff,
  weekend, color, schedule, globalOvertimeCoeff, onChange
}: {
  code?: AttendanceCode
  hours: number
  arrivalTime?: string
  departureTime?: string
  overtimeCoeff?: number
  weekend: boolean
  color?: string
  schedule: Schedule
  globalOvertimeCoeff: number
  onChange: (code: AttendanceCode, hours: number, arrivalTime?: string, departureTime?: string, overtimeCoeff?: number) => void
}) {
  const { t } = useLang()
  const [open, setOpen] = useState(false)
  const [selCode, setSelCode] = useState<AttendanceCode>(code ?? (weekend ? 'В' : 'Я'))
  const [arrival, setArrival] = useState<dayjs.Dayjs | null>(
    arrivalTime ? dayjs(arrivalTime, 'HH:mm') : dayjs(schedule.start, 'HH:mm')
  )
  const [departure, setDeparture] = useState<dayjs.Dayjs | null>(
    departureTime ? dayjs(departureTime, 'HH:mm') : dayjs(schedule.end, 'HH:mm')
  )

  const showTimes = WORKING_CODES.includes(selCode)

  const calculatedHours = showTimes && arrival && departure
    ? calcWorkedHours(arrival.format('HH:mm'), departure.format('HH:mm'), schedule.lunchStart, schedule.lunchEnd)
    : hours

  const normHoursPerDay = calcWorkedHours(schedule.start, schedule.end, schedule.lunchStart, schedule.lunchEnd)
  const extraHrs = showTimes ? Math.max(0, calculatedHours - normHoursPerDay) : 0

  function apply() {
    const arr = showTimes && arrival ? arrival.format('HH:mm') : undefined
    const dep = showTimes && departure ? departure.format('HH:mm') : undefined
    onChange(selCode, calculatedHours, arr, dep, undefined)
    setOpen(false)
  }

  function handleOpenChange(o: boolean) {
    if (o) {
      setSelCode(code ?? (weekend ? 'В' : 'Я'))
      setArrival(arrivalTime ? dayjs(arrivalTime, 'HH:mm') : dayjs(schedule.start, 'HH:mm'))
      setDeparture(departureTime ? dayjs(departureTime, 'HH:mm') : dayjs(schedule.end, 'HH:mm'))
    }
    setOpen(o)
  }

  const content = (
    <Space direction="vertical" size={8} style={{ width: 230 }}>
      <Select
        value={selCode}
        onChange={(v) => setSelCode(v as AttendanceCode)}
        style={{ width: '100%' }}
        options={ATTENDANCE_CODES.map((c) => ({
          value: c.code,
          label: `${c.code} — ${t.timesheet.attendance[c.code] ?? c.label}`
        }))}
      />

      {showTimes && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 12, width: 52, flexShrink: 0 }}>{t.timesheet.arrival}:</span>
            <TimePicker value={arrival} onChange={setArrival} format="HH:mm" minuteStep={5} style={{ flex: 1 }} size="small" />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 12, width: 52, flexShrink: 0 }}>{t.timesheet.departure}:</span>
            <TimePicker value={departure} onChange={setDeparture} format="HH:mm" minuteStep={5} style={{ flex: 1 }} size="small" />
          </div>
          <div style={{ fontSize: 12, color: '#555', display: 'flex', justifyContent: 'space-between' }}>
            <span>{t.timesheet.workedHours}: <b style={{ color: '#1677ff' }}>{calculatedHours}</b></span>
            {extraHrs > 0 && (
              <span style={{ color: '#fa8c16' }}>
                +{extraHrs.toFixed(2).replace(/\.?0+$/, '')} {t.timesheet.overtime}
              </span>
            )}
          </div>
        </>
      )}

      <Button type="primary" size="small" block onClick={apply}>{t.timesheet.save}</Button>
    </Space>
  )

  // Cell display: show code + arrival→departure or just hours
  const displayHours = hours > 0 ? hours : null
  const hasTimes = arrivalTime && departureTime

  return (
    <Popover content={content} trigger="click" open={open} onOpenChange={handleOpenChange}>
      <div
        className={`timesheet-cell${weekend && !code ? ' weekend' : ''}`}
        style={{ background: color || (code ? undefined : (weekend ? '#f5f5f5' : undefined)) }}
      >
        {code || (weekend ? 'В' : '')}
        {code && WORKING_CODES.includes(code) && (
          <div style={{ fontSize: 8, color: '#666', lineHeight: 1.2, marginTop: 1 }}>
            {hasTimes ? (
              <>
                <div>{arrivalTime}</div>
                <div>{departureTime}</div>
              </>
            ) : displayHours ? (
              <div>{displayHours}ч</div>
            ) : null}
          </div>
        )}
      </div>
    </Popover>
  )
}

import { useState, useEffect, useRef, useCallback } from 'react'
import { Table, Select, Typography, Popover, Button, Space, Spin, message, Tooltip, Dropdown } from 'antd'
import { LeftOutlined, RightOutlined } from '@ant-design/icons'
import { useRepository } from '../../api/RepositoryContext'
import { useLang } from '../../i18n/LangContext'
import type { Employee, TimesheetRecord, AttendanceCode, AppSettings } from '../../types'
import { ATTENDANCE_CODES } from '../../types'

const { Title } = Typography

type RecordMap = Map<string, TimesheetRecord>

type CopiedCell = {
  code: AttendanceCode
  hours: number
  arrivalTime?: string
  departureTime?: string
}

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
  const [openCellKey, setOpenCellKey] = useState<string | null>(null)
  const [copiedCell, setCopiedCell] = useState<CopiedCell | null>(null)

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
        const cellKey = `${emp.id}_${day}`
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
            cellKey={cellKey}
            openCellKey={openCellKey}
            setOpenCellKey={setOpenCellKey}
            onTabNext={() => {
              if (day < daysInMonth) setOpenCellKey(`${emp.id}_${day + 1}`)
              else setOpenCellKey(null)
            }}
            copiedCell={copiedCell}
            onCopy={(data) => setCopiedCell(data)}
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
          if (rec && rec.code === 'Я') days++
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
          if (rec && rec.code === 'Я') hours += rec.hours
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
  weekend, color, schedule, globalOvertimeCoeff, onChange,
  cellKey, openCellKey, setOpenCellKey, onTabNext,
  copiedCell, onCopy
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
  cellKey: string
  openCellKey: string | null
  setOpenCellKey: (key: string | null) => void
  onTabNext: () => void
  copiedCell: CopiedCell | null
  onCopy: (data: CopiedCell) => void
}) {
  const { t } = useLang()
  const open = openCellKey === cellKey

  const [selCode, setSelCode] = useState<AttendanceCode>(code ?? (weekend ? 'В' : 'Я'))
  const [arrH, setArrH] = useState(8)
  const [arrM, setArrM] = useState(30)
  const [depH, setDepH] = useState(17)
  const [depM, setDepM] = useState(0)

  const refAH = useRef<HTMLInputElement>(null)
  const refAM = useRef<HTMLInputElement>(null)
  const refDH = useRef<HTMLInputElement>(null)
  const refDM = useRef<HTMLInputElement>(null)

  const showTimes = selCode === 'Я'

  useEffect(() => {
    if (open) {
      const arr = arrivalTime ?? schedule.start
      const dep = departureTime ?? schedule.end
      const [ah, am] = arr.split(':').map(Number)
      const [dh, dm] = dep.split(':').map(Number)
      setSelCode(code ?? (weekend ? 'В' : 'Я'))
      setArrH(ah); setArrM(am); setDepH(dh); setDepM(dm)
      setTimeout(() => refAH.current?.focus(), 60)
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  function pad2(n: number) { return String(Math.min(99, Math.max(0, n || 0))).padStart(2, '0') }
  function getArrStr() { return `${pad2(arrH)}:${pad2(arrM)}` }
  function getDepStr() { return `${pad2(depH)}:${pad2(depM)}` }

  const normHoursPerDay = calcWorkedHours(schedule.start, schedule.end, schedule.lunchStart, schedule.lunchEnd)
  const calculatedHours = showTimes
    ? calcWorkedHours(getArrStr(), getDepStr(), schedule.lunchStart, schedule.lunchEnd)
    : hours
  const extraHrs = showTimes ? Math.max(0, calculatedHours - normHoursPerDay) : 0

  function apply() {
    const arr = showTimes ? getArrStr() : undefined
    const dep = showTimes ? getDepStr() : undefined
    const calcH = showTimes
      ? calcWorkedHours(getArrStr(), getDepStr(), schedule.lunchStart, schedule.lunchEnd)
      : (hours > 0 ? hours : normHoursPerDay)
    onChange(selCode, calcH, arr, dep, undefined)
    setOpenCellKey(null)
  }

  function handleKey(e: React.KeyboardEvent, field: 'arrH' | 'arrM' | 'depH' | 'depM') {
    if (e.key === 'Tab') {
      e.preventDefault()
      if (field === 'arrH') refAM.current?.focus()
      else if (field === 'arrM') refDH.current?.focus()
      else if (field === 'depH') refDM.current?.focus()
      else { apply(); onTabNext() }
    } else if (e.key === 'Enter') {
      apply()
    } else if (e.key === 'Escape') {
      setOpenCellKey(null)
    }
  }

  const inputStyle: React.CSSProperties = {
    width: 42, padding: '3px 4px', fontSize: 14,
    border: '1px solid #d9d9d9', borderRadius: 4,
    textAlign: 'center', outline: 'none', fontFamily: 'monospace'
  }

  const content = (
    <Space direction="vertical" size={6} style={{ width: 210 }}>
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 12, width: 52, flexShrink: 0 }}>{t.timesheet.arrival}:</span>
            <input ref={refAH} type="number" min={0} max={23} value={arrH}
              onChange={(e) => setArrH(parseInt(e.target.value) || 0)}
              onKeyDown={(e) => handleKey(e, 'arrH')}
              onFocus={(e) => e.target.select()}
              style={inputStyle} />
            <span style={{ fontWeight: 600 }}>:</span>
            <input ref={refAM} type="number" min={0} max={59} value={arrM}
              onChange={(e) => setArrM(parseInt(e.target.value) || 0)}
              onKeyDown={(e) => handleKey(e, 'arrM')}
              onFocus={(e) => e.target.select()}
              style={inputStyle} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 12, width: 52, flexShrink: 0 }}>{t.timesheet.departure}:</span>
            <input ref={refDH} type="number" min={0} max={23} value={depH}
              onChange={(e) => setDepH(parseInt(e.target.value) || 0)}
              onKeyDown={(e) => handleKey(e, 'depH')}
              onFocus={(e) => e.target.select()}
              style={inputStyle} />
            <span style={{ fontWeight: 600 }}>:</span>
            <input ref={refDM} type="number" min={0} max={59} value={depM}
              onChange={(e) => setDepM(parseInt(e.target.value) || 0)}
              onKeyDown={(e) => handleKey(e, 'depM')}
              onFocus={(e) => e.target.select()}
              style={inputStyle} />
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

  const contextMenuItems = [
    {
      key: 'copy',
      label: (t.timesheet as any).copy ?? 'Копировать',
      disabled: !code,
      onClick: () => { if (code) onCopy({ code, hours, arrivalTime, departureTime }) }
    },
    {
      key: 'paste',
      label: (t.timesheet as any).paste ?? 'Вставить',
      disabled: !copiedCell,
      onClick: () => {
        if (copiedCell) {
          onChange(copiedCell.code, copiedCell.hours, copiedCell.arrivalTime, copiedCell.departureTime, undefined)
        }
      }
    }
  ]

  const displayHours = hours > 0 ? hours : null
  const hasTimes = arrivalTime && departureTime

  return (
    <Popover content={content} trigger="click" open={open}
      onOpenChange={(o) => setOpenCellKey(o ? cellKey : null)}>
      <Dropdown trigger={['contextMenu']} menu={{ items: contextMenuItems }}>
        <div
          className={`timesheet-cell${weekend && !code ? ' weekend' : ''}`}
          style={{ background: color || (code ? undefined : (weekend ? '#f5f5f5' : undefined)) }}
        >
          {code || (weekend ? 'В' : '')}
          {code === 'Я' && (
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
      </Dropdown>
    </Popover>
  )
}

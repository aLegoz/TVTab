import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Table, Button, Typography, Spin, message, Tag, Drawer,
  Descriptions, Divider, Space, Statistic, InputNumber, Tooltip, Dropdown
} from 'antd'
import {
  FileExcelOutlined, FilePdfOutlined,
  InfoCircleOutlined, DownloadOutlined
} from '@ant-design/icons'
import { useRepository } from '../../api/RepositoryContext'
import { useCompany } from '../../App'
import { useLang } from '../../i18n/LangContext'
import { useMonth } from '../../i18n/MonthContext'
import { ATTENDANCE_CODES } from '../../types'
import type { SalarySummary, SalaryDetail, DayRecord } from '../../types'
import dayjs from 'dayjs'

const { Title, Text } = Typography

function fmt(n: number) {
  return n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtH(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, '')
}

export default function SalaryPage() {
  const repo = useRepository()
  const { company } = useCompany()
  const { t, lang } = useLang()
  const { year, month } = useMonth()
  const cur = company.currency
  const [data, setData] = useState<SalarySummary[]>([])
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [detail, setDetail] = useState<SalaryDetail | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailExporting, setDetailExporting] = useState(false)
  const [monthCoeff, setMonthCoeff] = useState<number | null>(null)
  const [coeffInput, setCoeffInput] = useState<number>(1.5)
  const [coeffIsCustom, setCoeffIsCustom] = useState(false)
  const [vacCoeff, setVacCoeff] = useState<number | null>(null)
  const [vacInput, setVacInput] = useState<number>(1)
  const [sickCoeff, setSickCoeff] = useState<number | null>(null)
  const [sickInput, setSickInput] = useState<number>(0)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [summary, coeff, vac, sick] = await Promise.all([
        repo.getSalarySummary(year, month),
        repo.getMonthOvertimeCoeff(year, month),
        repo.getMonthVacationCoeff(year, month),
        repo.getMonthSickCoeff(year, month),
      ])
      setData(summary)
      setMonthCoeff(coeff)
      setCoeffInput(coeff ?? 1.5)
      setCoeffIsCustom(coeff !== null)
      setVacCoeff(vac)
      setVacInput(vac ?? 1)
      setSickCoeff(sick)
      setSickInput(sick ?? 0)
    } finally {
      setLoading(false)
    }
  }, [repo, year, month])

  useEffect(() => { load() }, [load])

  const loadRef = useRef(load)
  useEffect(() => { loadRef.current = load }, [load])
  useEffect(() => repo.subscribeToChanges(() => loadRef.current()), [repo])

  async function openDetail(summary: SalarySummary) {
    setDetailOpen(true)
    setDetailLoading(true)
    try {
      const d = await repo.getSalaryDetail(summary.employee.id, year, month)
      setDetail(d)
    } catch (e: any) {
      message.error(e.message)
    } finally {
      setDetailLoading(false)
    }
  }

  async function saveCoeff(val: number | null) {
    if (val === null || val < 1) return
    await repo.setMonthOvertimeCoeff(year, month, val)
    setMonthCoeff(val)
    setCoeffIsCustom(true)
    message.success(t.salary.overtimeCoeffSaved)
    load()
  }

  async function saveVacCoeff(val: number | null) {
    if (val === null || val < 0) return
    await repo.setMonthVacationCoeff(year, month, val)
    setVacCoeff(val)
    message.success((t.salary as any).vacationCoeffSaved)
    load()
  }

  async function saveSickCoeff(val: number | null) {
    if (val === null || val < 0) return
    await repo.setMonthSickCoeff(year, month, val)
    setSickCoeff(val)
    message.success((t.salary as any).sickCoeffSaved)
    load()
  }

  async function exportDetail(colorMode: 'color' | 'bw') {
    if (!detail) return
    setDetailExporting(true)
    try {
      const path = await repo.exportDetailToPdf(detail.employee.id, year, month, colorMode, lang)
      if (path) message.success(`PDF: ${path}`)
    } catch (e: any) { message.error(e.message) }
    finally { setDetailExporting(false) }
  }

  async function exportExcel() {
    setExporting(true)
    try {
      const path = await repo.exportSalaryToExcel(year, month, lang)
      if (path) message.success(`Excel: ${path}`)
    } catch (e: any) { message.error(e.message) }
    finally { setExporting(false) }
  }

  async function exportPdf() {
    setExporting(true)
    try {
      const path = await repo.exportSalaryToPdf(year, month, lang)
      if (path) message.success(`PDF: ${path}`)
    } catch (e: any) { message.error(e.message) }
    finally { setExporting(false) }
  }

  const totalSalary = data.reduce((s, r) => s + r.salary, 0)
  const totalDays   = data.reduce((s, r) => s + r.workedDays, 0)
  const totalHours  = data.reduce((s, r) => s + r.workedHours, 0)

  const columns = [
    { title: t.employees.colNum, width: 48, render: (_: any, __: any, i: number) => i + 1 },
    { title: t.salary.colEmployee, key: 'name', render: (_: any, r: SalarySummary) => r.employee.fullName },
    { title: t.salary.colPosition, key: 'pos', render: (_: any, r: SalarySummary) => r.employee.position || '—' },
    {
      title: t.salary.colRate, key: 'rate', width: 170,
      render: (_: any, r: SalarySummary) => (
        <div style={{ lineHeight: 1.4 }}>
          <Tag color={r.effectiveRateType === 'hourly' ? 'blue' : 'green'} style={{ marginBottom: 2 }}>
            {r.effectiveRate.toLocaleString('ru-RU')}{' '}
            {r.effectiveRateType === 'hourly' ? `${cur}${t.salary.perHour}` : `${cur}${t.salary.perMonth}`}
          </Tag>
          {r.effectiveRateType === 'monthly' && (
            <div style={{ fontSize: 11, color: '#888' }}>
              ≈ {r.derivedHourlyRate.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} {cur}{t.salary.perHour}
            </div>
          )}
        </div>
      )
    },
    { title: t.salary.colDays,    dataIndex: 'workedDays',   key: 'days',  width: 60, align: 'center' as const },
    { title: t.salary.colHours,   dataIndex: 'workedHours',  key: 'hours', width: 65, align: 'center' as const },
    { title: t.salary.colVacation,dataIndex: 'vacationDays', key: 'vac',   width: 65, align: 'center' as const },
    { title: t.salary.colSick,    dataIndex: 'sickDays',     key: 'sick',  width: 60, align: 'center' as const },
    {
      title: t.salary.colTotal, key: 'salary', width: 130, align: 'right' as const,
      render: (_: any, r: SalarySummary) => (
        <span style={{ fontWeight: 700, color: '#1677ff' }}>
          {r.salary.toLocaleString('ru-RU', { minimumFractionDigits: 2 })} {cur}
        </span>
      )
    },
    {
      title: '', key: 'detail', width: 50,
      render: (_: any, r: SalarySummary) => (
        <Button
          size="small"
          icon={<InfoCircleOutlined />}
          onClick={() => openDetail(r)}
          title={t.salary.detail}
        />
      )
    }
  ]

  return (
    <Spin spinning={loading || exporting}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <Title level={4} style={{ margin: 0 }}>{t.salary.title}</Title>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 16, flexWrap: 'wrap' }}>
          <Tooltip title={coeffIsCustom ? undefined : t.salary.overtimeCoeffGlobal}>
            <span style={{ fontSize: 12, color: coeffIsCustom ? '#333' : '#999' }}>
              {t.salary.overtimeCoeffLabel}
            </span>
          </Tooltip>
          <InputNumber
            min={1} max={5} step={0.1} precision={2}
            value={coeffInput}
            onChange={(v) => setCoeffInput(v ?? 1.5)}
            onBlur={() => saveCoeff(coeffInput)}
            onPressEnter={() => saveCoeff(coeffInput)}
            style={{ width: 72 }} size="small"
          />
          <span style={{ fontSize: 12, color: vacCoeff !== null ? '#333' : '#999', marginLeft: 8 }}>
            {(t.salary as any).vacationCoeffLabel}
          </span>
          <InputNumber
            min={0} max={5} step={0.1} precision={2}
            value={vacInput}
            onChange={(v) => setVacInput(v ?? 1)}
            onBlur={() => saveVacCoeff(vacInput)}
            onPressEnter={() => saveVacCoeff(vacInput)}
            style={{ width: 72 }} size="small"
          />
          <span style={{ fontSize: 12, color: sickCoeff !== null ? '#333' : '#999', marginLeft: 8 }}>
            {(t.salary as any).sickCoeffLabel}
          </span>
          <InputNumber
            min={0} max={5} step={0.1} precision={2}
            value={sickInput}
            onChange={(v) => setSickInput(v ?? 0)}
            onBlur={() => saveSickCoeff(sickInput)}
            onPressEnter={() => saveSickCoeff(sickInput)}
            style={{ width: 72 }} size="small"
          />
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <Button icon={<FileExcelOutlined />} onClick={exportExcel} loading={exporting}>Excel</Button>
          <Button icon={<FilePdfOutlined />} onClick={exportPdf} loading={exporting}>PDF</Button>
        </div>
      </div>

      <Table
        dataSource={data}
        columns={columns}
        rowKey={(r) => r.employee.id}
        size="small"
        pagination={false}
        bordered
        summary={() => (
          <Table.Summary.Row style={{ background: '#fafafa', fontWeight: 700 }}>
            <Table.Summary.Cell index={0} colSpan={4}>{t.salary.total}</Table.Summary.Cell>
            <Table.Summary.Cell index={4} align="center">{totalDays}</Table.Summary.Cell>
            <Table.Summary.Cell index={5} align="center">{fmtH(totalHours)}</Table.Summary.Cell>
            <Table.Summary.Cell index={6} align="center" />
            <Table.Summary.Cell index={7} align="center" />
            <Table.Summary.Cell index={8} align="right">
              <span style={{ color: '#1677ff' }}>
                {totalSalary.toLocaleString('ru-RU', { minimumFractionDigits: 2 })} {cur}
              </span>
            </Table.Summary.Cell>
            <Table.Summary.Cell index={9} />
          </Table.Summary.Row>
        )}
      />

      {/* Drawer детального расчёта */}
      <Drawer
        title={
          detail
            ? `${detail.employee.fullName} — ${t.timesheet.months[month - 1]} ${year}`
            : t.salary.detailTitle
        }
        extra={
          <Dropdown
            disabled={!detail || detailExporting}
            menu={{
              items: [
                { key: 'color', label: '🎨 Кольоровий PDF', onClick: () => exportDetail('color') },
                { key: 'bw',    label: '⬛ Чорно-білий PDF', onClick: () => exportDetail('bw') },
              ]
            }}
            trigger={['click']}
          >
            <Button icon={<DownloadOutlined />} size="small" loading={detailExporting}>
              PDF
            </Button>
          </Dropdown>
        }
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        width={560}
        styles={{ body: { padding: '16px 20px' } }}
      >
        <Spin spinning={detailLoading}>
          {detail && <DetailContent detail={detail} cur={cur} />}
        </Spin>
      </Drawer>
    </Spin>
  )
}

function DetailContent({ detail, cur }: { detail: SalaryDetail; cur: string }) {
  const { t } = useLang()
  const isMonthly = detail.effectiveRateType === 'monthly'
  const rh = fmt(detail.derivedHourlyRate)
  const workedHoursStr = fmtH(detail.workedHours)

  const codeMap = Object.fromEntries(ATTENDANCE_CODES.map((c) => [c.code, c]))

  const dayColumns = [
    {
      title: t.salary.colDate, dataIndex: 'date', key: 'date', width: 90,
      render: (v: string) => dayjs(v).format('DD.MM — ddd')
    },
    {
      title: t.salary.colCode, key: 'code', width: 110,
      render: (_: any, r: DayRecord) => {
        const info = codeMap[r.code]
        return (
          <span style={{
            background: info?.color ?? '#f5f5f5',
            border: '1px solid #d9d9d9', borderRadius: 3,
            padding: '0 6px', fontSize: 12
          }}>
            <b>{r.code}</b>
          </span>
        )
      }
    },
    {
      title: t.salary.colArrival, dataIndex: 'arrivalTime', key: 'arr', width: 70,
      render: (v?: string) => v ?? '—'
    },
    {
      title: t.salary.colDeparture, dataIndex: 'departureTime', key: 'dep', width: 70,
      render: (v?: string) => v ?? '—'
    },
    {
      title: t.salary.colHoursShort, dataIndex: 'hours', key: 'h', width: 60, align: 'right' as const,
      render: (v: number, r: DayRecord) =>
        r.code === 'Я' ? <b>{fmtH(v)}</b> : <span style={{ color: '#bbb' }}>—</span>
    },
  ]

  return (
    <>
      {/* Блок ставки */}
      <Divider orientation="left" style={{ marginTop: 0 }}>{t.salary.rateSection}</Divider>
      <Descriptions size="small" column={1} bordered style={{ marginBottom: 16 }}>
        <Descriptions.Item label={t.salary.rateType}>
          <Tag color={isMonthly ? 'green' : 'blue'}>
            {isMonthly ? t.salary.rateMonthly : t.salary.rateHourly}
          </Tag>
        </Descriptions.Item>
        <Descriptions.Item label={isMonthly ? `${t.salary.rateMonthly}` : `${t.salary.rateHourly}`}>
          <b>{detail.effectiveRate.toLocaleString('ru-RU')} {cur}{isMonthly ? t.salary.perMonth : t.salary.perHour}</b>
        </Descriptions.Item>
        <Descriptions.Item label={t.salary.norm}>
          <b>{detail.normDays}</b> {t.salary.normFormula
            .replace('{h}', String(detail.hoursPerDay))
            .replace('{total}', String(detail.normHours))}
        </Descriptions.Item>
        {isMonthly && (
          <Descriptions.Item label={t.salary.hourlyRate}>
            <span style={{ color: '#1677ff', fontWeight: 600 }}>
              {t.salary.hourlyFormula
                .replace('{rate}', detail.effectiveRate.toLocaleString('ru-RU'))
                .replace('{hours}', String(detail.normHours))
                .replace('{result}', `${rh} ${cur}${t.salary.perHour}`)}
            </span>
          </Descriptions.Item>
        )}
      </Descriptions>

      {/* Посещаемость */}
      <Divider orientation="left">{t.salary.attendSection}</Divider>
      <Table
        dataSource={detail.records}
        columns={dayColumns}
        rowKey="date"
        size="small"
        pagination={false}
        style={{ marginBottom: 8 }}
        locale={{ emptyText: '—' }}
      />
      <Space size={16} style={{ marginBottom: 16, flexWrap: 'wrap' }}>
        <Text>
          {t.salary.worked}: <b>{detail.workedDays} {t.salary.colDays.toLowerCase()}, {workedHoursStr} {t.salary.colHours.toLowerCase()}</b>
        </Text>
        {detail.vacationDays > 0 && (
          <Text><Tag color="orange">{t.salary.vacation}: {detail.vacationDays}</Tag></Text>
        )}
        {detail.sickDays > 0 && (
          <Text><Tag color="red">{t.salary.sick}: {detail.sickDays}</Tag></Text>
        )}
      </Space>

      {/* Итоговый расчёт */}
      <Divider orientation="left">{t.salary.calcSection}</Divider>
      <div style={{
        background: '#f6ffed', border: '1px solid #b7eb8f', borderRadius: 8,
        padding: '12px 16px', marginBottom: 16
      }}>
        {/* Обычные часы */}
        <div style={{ fontSize: 13, color: '#555', marginBottom: 4 }}>
          {t.salary.regularHours}: {t.salary.calcFormula
            .replace('{rate}', `${rh} ${cur}`)
            .replace('{hours}', fmtH(detail.regularHours))
            .replace('{salary}', `${fmt(detail.regularSalary)} ${cur}`)}
        </div>

        {/* Переробіток */}
        {detail.overtimeHours > 0 && (
          <div style={{ fontSize: 13, color: '#d46b08', marginBottom: 4 }}>
            {t.salary.overtimeHours} (×{detail.globalOvertimeCoeff}): {t.salary.calcFormula
              .replace('{rate}', `${rh} ${cur}`)
              .replace('{hours}', fmtH(detail.overtimeHours))
              .replace('{salary}', `${fmt(detail.overtimeSalary)} ${cur}`)}
          </div>
        )}

        {/* Відпускні */}
        {detail.vacationDays > 0 && (
          <div style={{ fontSize: 13, color: '#d48b08', marginBottom: 4 }}>
            {(t.salary as any).vacationPayLabel} ({detail.vacationDays} {t.salary.colDays.toLowerCase()}, ×{detail.vacationCoeff}):&nbsp;
            <b>{fmt(detail.vacationPay)} {cur}</b>
          </div>
        )}

        {/* Лікарняні */}
        {detail.sickDays > 0 && (
          <div style={{ fontSize: 13, color: '#cf1322', marginBottom: 4 }}>
            {(t.salary as any).sickPayLabel} ({detail.sickDays} {t.salary.colDays.toLowerCase()}, ×{detail.sickCoeff}):&nbsp;
            <b>{fmt(detail.sickPay)} {cur}</b>
          </div>
        )}

        <Divider style={{ margin: '8px 0' }} />
        <Statistic
          title={t.salary.toPay}
          value={fmt(detail.salary)}
          suffix={cur}
          valueStyle={{ color: '#1677ff', fontWeight: 700, fontSize: 28 }}
        />
      </div>
    </>
  )
}

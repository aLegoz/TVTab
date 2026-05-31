import { IpcMain, dialog, BrowserWindow, app } from 'electron'
import ExcelJS from 'exceljs'
import { all } from '../db'
import { getCurrentCompanyId } from '../db'
import { listCompanies } from '../companies'
import { writeFile, unlink } from 'fs/promises'
import { join } from 'path'

type ExportLang = 'ru' | 'uk' | 'en'

const I18N = {
  ru: {
    months: ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'],
    weekdays: ['Вс','Пн','Вт','Ср','Чт','Пт','Сб'],
    timesheetTitle: 'Табель учёта рабочего времени',
    colName: 'ФИО', colPosition: 'Должность', colDays: 'Дн.', colHours: 'Час.',
    total: 'ИТОГО:',
    detailTitle: 'Расчёт заработной платы',
    rateSection: 'Ставка', rateTypeLabel: 'Тип',
    rateMonthly: 'Оклад (почасовой учёт)', rateHourly: 'Почасовая',
    rateValueMonthly: 'Оклад', rateValueHourly: 'Ставка',
    normLabel: 'Норма', hoursUnit: 'ч', daysUnit: 'дн.',
    hourlyRateLabel: 'Часовая ставка',
    overtimeCoeffLabel: 'Коэф. переработки',
    summarySection: 'Итого',
    workedLabel: 'Отработано', regularLabel: 'из них обычных',
    overtimeLabel: 'Переработка', vacationLabel: 'Отпуск', sickLabel: 'Больничный',
    attendSection: 'Посещаемость',
    bwHint: '▪ заштрихованные = отработанные дни   ▪ тёмно-серые = выходные',
    colDate: 'Дата', colCode: 'Код', colArrival: 'Приход', colDeparture: 'Уход', colHoursShort: 'Ч.',
    calcSection: 'Расчёт', regularHoursLabel: 'Обычные часы',
    overtimeLineLabel: 'Переработка', toPay: 'К выплате',
    perMonth: '/мес', perHour: '/ч',
    numLocale: 'ru-RU', dateLocale: 'ru-RU',
    codes: { 'Я':'Явка','В':'Выходной','О':'Отпуск','Б':'Больничный','К':'Командировка','ОВ':'Доп. выходной','Н':'Неявка (уваж.)','НН':'Прогул','П':'Праздник' },
  },
  uk: {
    months: ['Січень','Лютий','Березень','Квітень','Травень','Червень','Липень','Серпень','Вересень','Жовтень','Листопад','Грудень'],
    weekdays: ['Нд','Пн','Вт','Ср','Чт','Пт','Сб'],
    timesheetTitle: 'Табель обліку робочого часу',
    colName: 'ПІБ', colPosition: 'Посада', colDays: 'Дн.', colHours: 'Год.',
    total: 'РАЗОМ:',
    detailTitle: 'Розрахунок заробітної плати',
    rateSection: 'Ставка', rateTypeLabel: 'Тип',
    rateMonthly: 'Оклад (погодинний облік)', rateHourly: 'Погодинна',
    rateValueMonthly: 'Оклад', rateValueHourly: 'Ставка',
    normLabel: 'Норма', hoursUnit: 'год', daysUnit: 'дн.',
    hourlyRateLabel: 'Год. ставка',
    overtimeCoeffLabel: 'Коеф. переробітку',
    summarySection: 'Підсумок',
    workedLabel: 'Відпрацьовано', regularLabel: 'з них звичайних',
    overtimeLabel: 'Переробіток', vacationLabel: 'Відпустка', sickLabel: 'Лікарняний',
    attendSection: 'Відвідуваність',
    bwHint: '▪ заштриховані = відпрацьовані дні   ▪ темно-сірі = вихідні',
    colDate: 'Дата', colCode: 'Код', colArrival: 'Прихід', colDeparture: 'Відхід', colHoursShort: 'Год.',
    calcSection: 'Розрахунок', regularHoursLabel: 'Звичайні години',
    overtimeLineLabel: 'Переробіток', toPay: 'До виплати',
    perMonth: '/міс', perHour: '/год',
    numLocale: 'uk-UA', dateLocale: 'uk-UA',
    codes: { 'Я':'Явка','В':'Вихідний','О':'Відпустка','Б':'Лікарняний','К':'Відрядження','ОВ':'Дод. вихідний','Н':'Неявка (поваж.)','НН':'Прогул','П':'Свято' },
  },
  en: {
    months: ['January','February','March','April','May','June','July','August','September','October','November','December'],
    weekdays: ['Su','Mo','Tu','We','Th','Fr','Sa'],
    timesheetTitle: 'Timesheet',
    colName: 'Full name', colPosition: 'Position', colDays: 'Days', colHours: 'Hours',
    total: 'TOTAL:',
    detailTitle: 'Salary breakdown',
    rateSection: 'Rate', rateTypeLabel: 'Type',
    rateMonthly: 'Salary (hourly tracking)', rateHourly: 'Hourly',
    rateValueMonthly: 'Salary', rateValueHourly: 'Rate',
    normLabel: 'Norm', hoursUnit: 'hr', daysUnit: 'days',
    hourlyRateLabel: 'Hourly rate',
    overtimeCoeffLabel: 'Overtime coeff.',
    summarySection: 'Summary',
    workedLabel: 'Worked', regularLabel: 'of which regular',
    overtimeLabel: 'Overtime', vacationLabel: 'Vacation', sickLabel: 'Sick leave',
    attendSection: 'Attendance',
    bwHint: '▪ shaded = worked days   ▪ dark grey = weekends',
    colDate: 'Date', colCode: 'Code', colArrival: 'Arrival', colDeparture: 'Departure', colHoursShort: 'Hrs.',
    calcSection: 'Calculation', regularHoursLabel: 'Regular hours',
    overtimeLineLabel: 'Overtime', toPay: 'Amount due',
    perMonth: '/mo', perHour: '/hr',
    numLocale: 'en-US', dateLocale: 'en-US',
    codes: { 'Я':'Work','В':'Day off','О':'Vacation','Б':'Sick leave','К':'Business trip','ОВ':'Extra day off','Н':'Absence (excused)','НН':'No-show','П':'Holiday' },
  },
} as const

const CODE_COLORS: Record<string, string> = {
  'Я': '#e6f7ff', 'К': '#f6ffed', 'О': '#fff7e6',
  'Б': '#fff1f0', 'ОВ': '#f9f0ff', 'Н': '#fffbe6',
  'НН': '#ffccc7', 'П': '#ffd6e7', 'В': '',
}

function fmt2(n: number, locale: string) {
  return n.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtH(n: number) { return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, '') }

function getSettingVal(key: string, def: string): string {
  const row = (all(`SELECT value FROM settings WHERE key='${key}'`) as any[])[0]
  return row?.value ?? def
}

function getWorkingDaysInMonth(year: number, month: number, holidayDates: string[], workdayDates: string[]): number {
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

function buildTimesheetHtml(
  year: number, month: number, daysInMonth: number,
  employees: any[], records: any[], companyName: string, lang: ExportLang
): string {
  const i = I18N[lang]
  const prefix = `${year}-${String(month).padStart(2, '0')}`

  const dayHeaders = Array.from({ length: daysInMonth }, (_, idx) => {
    const d = idx + 1
    const dow = new Date(year, month - 1, d).getDay()
    const isWknd = dow === 0 || dow === 6
    const wd = i.weekdays[dow]
    const bg = isWknd ? 'background:#f5f5f5;' : ''
    const col = isWknd ? 'color:#aaa;' : ''
    return `<th style="width:20px;${bg}${col}">${d}<br/><span style="font-size:7px">${wd}</span></th>`
  }).join('')

  const rows = employees.map((emp: any, idx: number) => {
    const empRecs = records.filter((r: any) => r.employee_id === emp.id)
    let workedDays = 0, workedHours = 0

    const cells = Array.from({ length: daysInMonth }, (_, ci) => {
      const d = ci + 1
      const dow = new Date(year, month - 1, d).getDay()
      const isWknd = dow === 0 || dow === 6
      const dateStr = `${prefix}-${String(d).padStart(2, '0')}`
      const rec = empRecs.find((r: any) => r.date === dateStr)
      const code = rec?.code ?? (isWknd ? 'В' : '')
      const bg = CODE_COLORS[code] ?? ''
      const wkndBg = isWknd && !rec ? 'background:#f9f9f9;' : ''
      if (rec && (rec.code === 'Я' || rec.code === 'К')) { workedDays++; workedHours += rec.hours }
      const bgStyle = bg ? `background:${bg};` : wkndBg
      const isWorked = rec && (rec.code === 'Я' || rec.code === 'К')
      const cellText = isWorked
        ? (rec.hours % 1 === 0 ? String(rec.hours) : rec.hours.toFixed(1))
        : code
      return `<td style="${bgStyle}font-size:8px;">${cellText}</td>`
    }).join('')

    const rowBg = idx % 2 === 1 ? 'background:#fafafa;' : ''
    return `
      <tr style="${rowBg}">
        <td>${idx + 1}</td>
        <td style="text-align:left;padding-left:4px;">${emp.full_name}</td>
        <td style="text-align:left;padding-left:4px;font-size:8px;color:#555">${emp.position ?? ''}</td>
        ${cells}
        <td style="font-weight:bold">${workedDays}</td>
        <td style="font-weight:bold">${workedHours % 1 === 0 ? workedHours : workedHours.toFixed(1)}</td>
      </tr>`
  }).join('')

  const totalDays = employees.reduce((s: number, emp: any) =>
    s + records.filter((r: any) => r.employee_id === emp.id && (r.code === 'Я' || r.code === 'К')).length, 0)
  const totalHours = employees.reduce((s: number, emp: any) =>
    s + records.filter((r: any) => r.employee_id === emp.id && (r.code === 'Я' || r.code === 'К'))
      .reduce((h: number, r: any) => h + r.hours, 0), 0)

  return `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 9px; }
  .header { text-align: center; margin-bottom: 10px; }
  .header h2 { font-size: 13px; margin-bottom: 2px; }
  .header p { font-size: 10px; color: #555; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  th, td { border: 1px solid #bbb; padding: 2px 1px; text-align: center; vertical-align: middle; overflow: hidden; }
  th { background: #e8e8e8; font-weight: bold; }
  .tfoot-row td { background: #e8e8e8; font-weight: bold; }
  .legend { margin-top: 8px; display: flex; gap: 12px; flex-wrap: wrap; font-size: 8px; }
  .legend-item { display: flex; align-items: center; gap: 3px; }
  .legend-box { width: 12px; height: 12px; border: 1px solid #ccc; display: inline-block; }
  @page { size: A4 landscape; margin: 8mm 10mm; }
  @media print { * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; } }
</style>
</head>
<body>
<div class="header">
  <h2>${companyName} — ${i.timesheetTitle}</h2>
  <p>${i.months[month - 1]} ${year}</p>
</div>
<table>
  <colgroup>
    <col style="width:24px"/>
    <col style="width:150px"/>
    <col style="width:100px"/>
    ${Array.from({ length: daysInMonth }, () => '<col style="width:20px"/>').join('')}
    <col style="width:30px"/>
    <col style="width:30px"/>
  </colgroup>
  <thead>
    <tr>
      <th>№</th>
      <th>${i.colName}</th>
      <th>${i.colPosition}</th>
      ${dayHeaders}
      <th>${i.colDays}</th>
      <th>${i.colHours}</th>
    </tr>
  </thead>
  <tbody>${rows}</tbody>
  <tfoot>
    <tr class="tfoot-row">
      <td colspan="3" style="text-align:right;padding-right:6px;font-weight:bold;">${i.total}</td>
      ${Array.from({ length: daysInMonth }, () => '<td></td>').join('')}
      <td>${totalDays}</td>
      <td>${totalHours % 1 === 0 ? totalHours : totalHours.toFixed(1)}</td>
    </tr>
  </tfoot>
</table>
<div class="legend">
  ${Object.entries(CODE_COLORS).map(([code, bg]) =>
    `<div class="legend-item"><span class="legend-box" style="${bg ? `background:${bg}` : ''}"></span> ${code}</div>`
  ).join('')}
</div>
</body></html>`
}

function buildDetailHtml(empData: {
  companyName: string; currency: string
  empName: string; position: string; year: number; month: number
  normDays: number; normHours: number; hoursPerDay: number
  rateType: string; rate: number; derivedHourlyRate: number; overtimeCoeff: number
  records: any[]; workedDays: number; regularHours: number
  overtimeHours: number; workedHours: number
  vacationDays: number; sickDays: number
  regularSalary: number; overtimeSalary: number; salary: number
  colorMode: 'color' | 'bw'; lang: ExportLang
}): string {
  const {
    companyName, currency, empName, position, year, month,
    normDays, normHours, hoursPerDay, rateType, rate, derivedHourlyRate, overtimeCoeff,
    records, workedDays, regularHours, overtimeHours, workedHours,
    vacationDays, sickDays, regularSalary, overtimeSalary, salary, colorMode, lang,
  } = empData
  const i = I18N[lang]
  const bw = colorMode === 'bw'
  const isMonthly = rateType === 'monthly'
  const rh = fmt2(derivedHourlyRate, i.numLocale)
  const monthName = i.months[month - 1]

  const attendRows = records.map((r: any, idx: number) => {
    const dow = new Date(r.date).getDay()
    const isWknd = dow === 0 || dow === 6
    const isWorked = r.code === 'Я' || r.code === 'К'
    const dateStr = new Date(r.date).toLocaleDateString(i.dateLocale, { day: '2-digit', month: '2-digit', weekday: 'short' })
    const hoursCell = isWorked ? `<b>${fmtH(r.hours)}</b>` : '—'

    let rowStyle = ''
    let codeStyle = ''
    if (bw) {
      if (isWorked) {
        rowStyle = idx % 2 === 0 ? 'background:#f0f0f0;' : 'background:#e4e4e4;'
        codeStyle = 'border-left:3px solid #333;font-weight:bold;'
      } else if (isWknd) {
        rowStyle = 'background:#d8d8d8;color:#555;'
      } else {
        rowStyle = idx % 2 === 1 ? 'background:#fafafa;' : ''
      }
    } else {
      const bg = CODE_COLORS[r.code] ?? ''
      const wkndBg = isWknd && !bg ? '#f9f9f9' : ''
      rowStyle = bg ? `background:${bg};` : wkndBg ? `background:${wkndBg};` : (idx % 2 === 1 ? 'background:#fafafa;' : '')
    }

    return `<tr style="${rowStyle}">
      <td>${idx + 1}</td>
      <td style="text-align:left">${dateStr}</td>
      <td style="${codeStyle}"><b>${r.code}</b></td>
      <td>${r.arrival_time ?? '—'}</td>
      <td>${r.departure_time ?? '—'}</td>
      <td style="text-align:right">${hoursCell}</td>
    </tr>`
  }).join('')

  const overtimeColor = bw ? '' : 'color:#d46b08;'
  const overtimeLine = overtimeHours > 0 ? `
    <div class="calc-line" style="${overtimeColor}${bw ? 'font-style:italic;' : ''}">
      ${i.overtimeLineLabel} (×${overtimeCoeff}): ${rh} ${currency} × ${fmtH(overtimeHours)} ${i.hoursUnit} = <b>${fmt2(overtimeSalary, i.numLocale)} ${currency}</b>
    </div>` : ''

  const calcBoxStyle = bw
    ? 'border: 2px solid #333; border-radius: 4px; padding: 8px 12px;'
    : 'background: #f6ffed; border: 1px solid #b7eb8f; border-radius: 4px; padding: 8px 12px;'
  const calcDividerStyle = bw ? 'border-top: 2px solid #333;' : 'border-top: 1px solid #b7eb8f;'
  const calcTotalStyle = bw
    ? 'font-size:16px;font-weight:bold;text-decoration:underline;margin-top:4px;'
    : 'font-size:16px;font-weight:bold;color:#1677ff;margin-top:4px;'
  const hourlyRateStyle = bw ? 'font-weight:bold;' : 'color:#1677ff;font-weight:bold;'
  const overtimeValueStyle = bw ? 'font-weight:bold;font-style:italic;' : 'color:#d46b08;font-weight:bold;'

  return `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 8.5px; color: #222; }
  .page-header { text-align: center; border-bottom: 2px solid #333; padding-bottom: 7px; margin-bottom: 10px; }
  .page-header h1 { font-size: 13px; margin-bottom: 2px; }
  .page-header .sub { font-size: 10px; color: #555; }
  .top-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 10px; }
  .section-title { font-weight: bold; font-size: 8px; text-transform: uppercase; letter-spacing: 0.4px;
    color: #444; border-bottom: ${bw ? '2px solid #333' : '1px solid #ddd'}; padding-bottom: 2px; margin-bottom: 5px; }
  .info-row { display: flex; justify-content: space-between; padding: 1.5px 0; border-bottom: 1px dotted ${bw ? '#aaa' : '#eee'}; }
  .info-row .label { color: ${bw ? '#444' : '#666'}; }
  .info-row .value { font-weight: 600; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
  th, td { border: 1px solid ${bw ? '#888' : '#ccc'}; padding: 2px 4px; text-align: center; vertical-align: middle; }
  th { background: ${bw ? '#d0d0d0' : '#efefef'}; font-size: 8px; font-weight: bold; }
  td { font-size: 8px; }
  .calc-line { margin-bottom: 4px; font-size: 8.5px; }
  @page { size: A4 portrait; margin: 8mm 10mm; }
  @media print { * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; } }
</style>
</head>
<body>

<div class="page-header">
  <h1>${companyName}</h1>
  <div class="sub">${i.detailTitle} &mdash; ${monthName} ${year}</div>
  <div class="sub" style="font-size:11px;font-weight:600;margin-top:3px;">${empName}${position ? ` &mdash; ${position}` : ''}</div>
</div>

<div class="top-grid">
  <div>
    <div class="section-title">${i.rateSection}</div>
    <div class="info-row"><span class="label">${i.rateTypeLabel}</span><span class="value">${isMonthly ? i.rateMonthly : i.rateHourly}</span></div>
    <div class="info-row"><span class="label">${isMonthly ? i.rateValueMonthly : i.rateValueHourly}</span><span class="value">${rate.toLocaleString(i.numLocale)} ${currency}${isMonthly ? i.perMonth : i.perHour}</span></div>
    <div class="info-row"><span class="label">${i.normLabel}</span><span class="value">${normDays} ${i.daysUnit} × ${hoursPerDay} ${i.hoursUnit} = ${normHours} ${i.hoursUnit}</span></div>
    ${isMonthly ? `<div class="info-row"><span class="label">${i.hourlyRateLabel}</span><span class="value" style="${hourlyRateStyle}">${rh} ${currency}${i.perHour}</span></div>` : ''}
    <div class="info-row"><span class="label">${i.overtimeCoeffLabel}</span><span class="value">×${overtimeCoeff}</span></div>
  </div>
  <div>
    <div class="section-title">${i.summarySection}</div>
    <div class="info-row"><span class="label">${i.workedLabel}</span><span class="value">${workedDays} ${i.daysUnit} / ${fmtH(workedHours)} ${i.hoursUnit}</span></div>
    ${regularHours !== workedHours ? `<div class="info-row"><span class="label">${i.regularLabel}</span><span class="value">${fmtH(regularHours)} ${i.hoursUnit}</span></div>` : ''}
    ${overtimeHours > 0 ? `<div class="info-row"><span class="label">${i.overtimeLabel}</span><span class="value" style="${overtimeValueStyle}">${fmtH(overtimeHours)} ${i.hoursUnit}</span></div>` : ''}
    ${vacationDays > 0 ? `<div class="info-row"><span class="label">${i.vacationLabel}</span><span class="value">${vacationDays} ${i.daysUnit}</span></div>` : ''}
    ${sickDays > 0 ? `<div class="info-row"><span class="label">${i.sickLabel}</span><span class="value">${sickDays} ${i.daysUnit}</span></div>` : ''}
  </div>
</div>

<div class="section-title">${i.attendSection}</div>
${bw ? `<div style="font-size:7.5px;color:#555;margin-bottom:3px;">${i.bwHint}</div>` : ''}
<table>
  <thead>
    <tr>
      <th style="width:20px">№</th>
      <th>${i.colDate}</th>
      <th style="width:28px">${i.colCode}</th>
      <th style="width:42px">${i.colArrival}</th>
      <th style="width:42px">${i.colDeparture}</th>
      <th style="width:36px">${i.colHoursShort}</th>
    </tr>
  </thead>
  <tbody>${attendRows}</tbody>
</table>

<div style="display:flex;flex-wrap:wrap;gap:6px 12px;margin-bottom:10px;">
  ${Object.entries(i.codes).map(([code, label]) => {
    const bg = CODE_COLORS[code] ?? ''
    const boxStyle = bg
      ? `background:${bg};border:1px solid #ccc;`
      : bw ? 'border:1px solid #888;' : 'border:1px solid #ccc;'
    return `<span style="display:inline-flex;align-items:center;gap:4px;font-size:7.5px;">
      <span style="${boxStyle}border-radius:2px;padding:0 4px;font-weight:bold;font-size:8px;">${code}</span>
      <span style="color:#444;">${label}</span>
    </span>`
  }).join('')}
</div>

<div style="${calcBoxStyle}">
  <div class="section-title" style="margin-bottom:6px">${i.calcSection}</div>
  <div class="calc-line">
    ${i.regularHoursLabel}: ${rh} ${currency} × ${fmtH(regularHours)} ${i.hoursUnit} = <b>${fmt2(regularSalary, i.numLocale)} ${currency}</b>
  </div>
  ${overtimeLine}
  <hr style="border:none;${calcDividerStyle}margin:6px 0;"/>
  <div style="${calcTotalStyle}">${i.toPay}: ${fmt2(salary, i.numLocale)} ${currency}</div>
</div>

</body></html>`
}

export function registerExportHandlers(ipc: IpcMain): void {
  ipc.handle('export:toExcel', async (_e, year: number, month: number, lang: ExportLang = 'uk') => {
    const i = I18N[lang]
    const prefix = `${year}-${String(month).padStart(2, '0')}`
    const daysInMonth = new Date(year, month, 0).getDate()

    const employees = all('SELECT * FROM employees WHERE is_active=1 ORDER BY full_name') as any[]
    const records = all('SELECT * FROM timesheet_records WHERE date LIKE ?', [prefix + '%']) as any[]

    const { filePath } = await dialog.showSaveDialog({
      defaultPath: `${i.timesheetTitle}_${year}_${String(month).padStart(2, '0')}.xlsx`,
      filters: [{ name: 'Excel', extensions: ['xlsx'] }]
    })
    if (!filePath) return null

    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet(`${i.months[month - 1]} ${year}`)

    const headerRow = ws.addRow([
      '№', i.colName, i.colPosition,
      ...Array.from({ length: daysInMonth }, (_, ci) => ci + 1),
      i.colDays, i.colHours,
    ])
    headerRow.font = { bold: true }
    headerRow.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    headerRow.height = 30

    ws.getColumn(1).width = 5
    ws.getColumn(2).width = 28
    ws.getColumn(3).width = 18
    for (let ci = 4; ci <= 3 + daysInMonth; ci++) ws.getColumn(ci).width = 5
    ws.getColumn(4 + daysInMonth).width = 7
    ws.getColumn(5 + daysInMonth).width = 7

    employees.forEach((emp: any, idx: number) => {
      const empRecords = records.filter((r: any) => r.employee_id === emp.id)
      const days: (string | number)[] = []
      let workedDays = 0, workedHours = 0

      for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${prefix}-${String(d).padStart(2, '0')}`
        const rec = empRecords.find((r: any) => r.date === dateStr)
        if (rec) {
          const isWorked = rec.code === 'Я' || rec.code === 'К'
          days.push(isWorked ? (rec.hours % 1 === 0 ? rec.hours : rec.hours.toFixed(1)) : rec.code)
          if (isWorked) { workedDays++; workedHours += rec.hours }
        } else {
          const dow = new Date(year, month - 1, d).getDay()
          days.push(dow === 0 || dow === 6 ? 'В' : '')
        }
      }

      const row = ws.addRow([idx + 1, emp.full_name, emp.position, ...days, workedDays, workedHours])
      row.alignment = { horizontal: 'center', vertical: 'middle' }
      row.getCell(2).alignment = { horizontal: 'left', vertical: 'middle' }
      row.getCell(3).alignment = { horizontal: 'left', vertical: 'middle' }
    })

    ws.addRow([])
    const totalsRow = ws.addRow([
      '', i.total.replace(':', ''), '', ...Array(daysInMonth).fill(''),
      employees.reduce((s: number, emp: any) =>
        s + records.filter((r: any) => r.employee_id === emp.id && (r.code === 'Я' || r.code === 'К')).length, 0),
      employees.reduce((s: number, emp: any) =>
        s + records.filter((r: any) => r.employee_id === emp.id && (r.code === 'Я' || r.code === 'К'))
          .reduce((h: number, r: any) => h + r.hours, 0), 0)
    ])
    totalsRow.font = { bold: true }

    await wb.xlsx.writeFile(filePath)
    return filePath
  })

  ipc.handle('export:toPdf', async (_e, year: number, month: number, lang: ExportLang = 'uk') => {
    const i = I18N[lang]
    const { filePath } = await dialog.showSaveDialog({
      defaultPath: `${i.timesheetTitle}_${year}_${String(month).padStart(2, '0')}.pdf`,
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    })
    if (!filePath) return null

    const prefix = `${year}-${String(month).padStart(2, '0')}`
    const daysInMonth = new Date(year, month, 0).getDate()
    const employees = all('SELECT * FROM employees WHERE is_active=1 ORDER BY full_name') as any[]
    const records = all('SELECT * FROM timesheet_records WHERE date LIKE ?', [prefix + '%']) as any[]
    const companyId = getCurrentCompanyId()
    const companyName = listCompanies().find((c) => c.id === companyId)?.name ?? 'TVTab'

    const html = buildTimesheetHtml(year, month, daysInMonth, employees, records, companyName, lang)

    const tmpPath = join(app.getPath('temp'), `tvtab_print_${Date.now()}.html`)
    await writeFile(tmpPath, html, 'utf8')
    const printWin = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: false, contextIsolation: true } })
    await printWin.loadFile(tmpPath)
    const data = await printWin.webContents.printToPDF({ printBackground: true, landscape: true, pageSize: 'A4' })
    printWin.close()
    await unlink(tmpPath).catch(() => {})

    await writeFile(filePath, data)
    return filePath
  })

  ipc.handle('salary:exportDetailPdf', async (_e,
    employeeId: number, year: number, month: number,
    colorMode: 'color' | 'bw' = 'color', lang: ExportLang = 'uk'
  ) => {
    const prefix = `${year}-${String(month).padStart(2, '0')}`
    const monthStart = `${prefix}-01`

    const holidayRows = all('SELECT date FROM holidays WHERE date LIKE ?', [prefix + '%']) as any[]
    const workdayRows = all('SELECT date FROM workdays WHERE date LIKE ?', [prefix + '%']) as any[]
    const normDays = getWorkingDaysInMonth(
      year, month,
      holidayRows.map((r: any) => r.date as string),
      workdayRows.map((r: any) => r.date as string)
    )
    const hoursPerDay = Number(getSettingVal('workHoursPerDay', '8'))
    const normHours = normDays * hoursPerDay
    const monthCoeffRow = (all(
      'SELECT value FROM month_settings WHERE year=? AND month=? AND key=?',
      [year, month, 'overtimeCoeff']
    ) as any[])[0]
    const overtimeCoeff = monthCoeffRow
      ? Number(monthCoeffRow.value)
      : Number(getSettingVal('overtimeCoeff', '1.5'))

    const emp = (all('SELECT * FROM employees WHERE id=?', [employeeId]) as any[])[0]
    if (!emp) throw new Error('Employee not found')

    const historyEntry = (all(
      'SELECT rate_type, rate FROM salary_history WHERE employee_id=? AND effective_from<=? ORDER BY effective_from DESC LIMIT 1',
      [employeeId, monthStart]
    ) as any[])[0]
    const rateType: string = historyEntry?.rate_type ?? emp.rate_type
    const rate: number = historyEntry?.rate ?? emp.rate

    const rows = all('SELECT * FROM timesheet_records WHERE employee_id=? AND date LIKE ? ORDER BY date',
      [employeeId, prefix + '%']) as any[]

    const workedRecs = rows.filter((r: any) => r.code === 'Я' || r.code === 'К')
    const vacationDays = rows.filter((r: any) => r.code === 'О').length
    const sickDays = rows.filter((r: any) => r.code === 'Б').length

    const derivedHourlyRate = rateType === 'hourly' ? rate : normHours > 0 ? rate / normHours : 0
    const totalWorked = workedRecs.reduce((s: number, r: any) => s + r.hours, 0)
    const overtimeHours = Math.max(0, totalWorked - normHours)
    const regularHours = totalWorked - overtimeHours
    const regularSalary = Math.round(derivedHourlyRate * regularHours * 100) / 100
    const overtimeSalary = Math.round(derivedHourlyRate * overtimeCoeff * overtimeHours * 100) / 100
    const salary = Math.round((regularSalary + overtimeSalary) * 100) / 100

    const companyId = getCurrentCompanyId()
    const companyEntry = listCompanies().find((c) => c.id === companyId)
    const companyName = companyEntry?.name ?? 'TVTab'
    const currency = companyEntry?.currency ?? '₴'
    const i = I18N[lang]

    const { filePath } = await dialog.showSaveDialog({
      defaultPath: `${emp.full_name.replace(/\s+/g, '_')}_${i.months[month - 1]}_${year}.pdf`,
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    })
    if (!filePath) return null

    const html = buildDetailHtml({
      companyName, currency,
      empName: emp.full_name, position: emp.position,
      year, month, normDays, normHours, hoursPerDay,
      rateType, rate, derivedHourlyRate: Math.round(derivedHourlyRate * 100) / 100, overtimeCoeff,
      records: rows,
      workedDays: workedRecs.length,
      regularHours: Math.round(regularHours * 100) / 100,
      overtimeHours: Math.round(overtimeHours * 100) / 100,
      workedHours: Math.round(totalWorked * 100) / 100,
      vacationDays, sickDays, regularSalary, overtimeSalary, salary,
      colorMode, lang,
    })

    const tmpPath = join(app.getPath('temp'), `tvtab_detail_${Date.now()}.html`)
    await writeFile(tmpPath, html, 'utf8')
    const printWin = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: false, contextIsolation: true } })
    await printWin.loadFile(tmpPath)
    const pdfData = await printWin.webContents.printToPDF({ printBackground: true, landscape: false, pageSize: 'A4' })
    printWin.close()
    await unlink(tmpPath).catch(() => {})

    await writeFile(filePath, pdfData)
    return filePath
  })
}

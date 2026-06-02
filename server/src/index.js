// TVTab REST API server
// Usage: node server/src/index.js [--port 3001] [--data-dir ./data]

const express = require('express')
const cors = require('cors')
const Database = require('better-sqlite3')
const path = require('path')
const fs = require('fs')
const ExcelJS = require('exceljs')

// ─── CLI args ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
const PORT = (() => { const i = args.indexOf('--port'); return i >= 0 ? Number(args[i+1]) : 3001 })()
const DATA_DIR = (() => { const i = args.indexOf('--data-dir'); return i >= 0 ? args[i+1] : './data' })()

fs.mkdirSync(path.join(DATA_DIR, 'companies'), { recursive: true })

// ─── Master DB (companies list) ───────────────────────────────────────────────
const masterDb = new Database(path.join(DATA_DIR, 'master.db'))
masterDb.exec(`
  CREATE TABLE IF NOT EXISTS companies (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    currency TEXT NOT NULL DEFAULT '₴',
    created_at TEXT NOT NULL,
    last_opened_at TEXT NOT NULL
  );
`)

function listCompanies() {
  return masterDb.prepare('SELECT * FROM companies ORDER BY last_opened_at DESC').all()
}
function getCompany(id) {
  return masterDb.prepare('SELECT * FROM companies WHERE id=?').get(id)
}

// ─── SSE broadcast ────────────────────────────────────────────────────────────
const sseClients = new Map()

function broadcast(companyId) {
  const clients = sseClients.get(companyId)
  if (!clients || clients.size === 0) return
  const data = 'event: change\ndata: {}\n\n'
  const dead = []
  for (const res of clients) {
    try { res.write(data) } catch { dead.push(res) }
  }
  dead.forEach(r => clients.delete(r))
}

// ─── Per-company DB management ────────────────────────────────────────────────
const companyDbs = {}
// ─── Audit log ────────────────────────────────────────────────────────────────
function appendAudit(companyId, action, data) {
  const logPath = path.join(DATA_DIR, 'companies', `${companyId}.audit.jsonl`)
  try { fs.appendFileSync(logPath, JSON.stringify({ ts: new Date().toISOString(), action, data }) + '\n') } catch {}
}

function applyAuditEntry(db, entry) {
  const { action, data: d } = entry
  switch (action) {
    case 'timesheet.save':
      db.prepare(`INSERT INTO timesheet_records (employee_id,date,code,hours,arrival_time,departure_time,overtime_coeff) VALUES (?,?,?,?,?,?,?)
        ON CONFLICT(employee_id,date) DO UPDATE SET code=excluded.code,hours=excluded.hours,arrival_time=excluded.arrival_time,departure_time=excluded.departure_time,overtime_coeff=excluded.overtime_coeff`)
        .run(d.employeeId, d.date, d.code, d.hours, d.arrivalTime??null, d.departureTime??null, d.overtimeCoeff??null); break
    case 'timesheet.delete': db.prepare('DELETE FROM timesheet_records WHERE employee_id=? AND date=?').run(d.employeeId, d.date); break
    case 'department.create': db.prepare('INSERT OR IGNORE INTO departments (id,name) VALUES (?,?)').run(d.id, d.name); break
    case 'department.delete': db.prepare('DELETE FROM departments WHERE id=?').run(d.id); break
    case 'employee.create':
      db.prepare('INSERT OR IGNORE INTO employees (id,full_name,position,department_id,rate_type,rate,hired_date,is_active) VALUES (?,?,?,?,?,?,?,1)')
        .run(d.id, d.fullName, d.position||'', d.departmentId??null, d.rateType, d.rate, d.hiredDate||null); break
    case 'employee.update':
      db.prepare('UPDATE employees SET full_name=?,position=?,department_id=?,rate_type=?,rate=?,hired_date=?,is_active=? WHERE id=?')
        .run(d.fullName, d.position||'', d.departmentId??null, d.rateType, d.rate, d.hiredDate||null, d.isActive?1:0, d.id); break
    case 'employee.deactivate': db.prepare('UPDATE employees SET is_active=0 WHERE id=?').run(d.id); break
    case 'salaryHistory.add':
      db.prepare('INSERT OR REPLACE INTO salary_history (id,employee_id,effective_from,rate_type,rate,note) VALUES (?,?,?,?,?,?)')
        .run(d.id, d.employeeId, d.effectiveFrom, d.rateType, d.rate, d.note||''); break
    case 'salaryHistory.delete': db.prepare('DELETE FROM salary_history WHERE id=?').run(d.id); break
    case 'holiday.toggle':
      if (d.active) db.prepare('INSERT OR IGNORE INTO holidays (date) VALUES (?)').run(d.date)
      else db.prepare('DELETE FROM holidays WHERE date=?').run(d.date); break
    case 'workday.toggle':
      if (d.active) db.prepare('INSERT OR IGNORE INTO workdays (date) VALUES (?)').run(d.date)
      else db.prepare('DELETE FROM workdays WHERE date=?').run(d.date); break
    case 'monthSettings.set':
      db.prepare('INSERT OR REPLACE INTO month_settings (year,month,key,value) VALUES (?,?,?,?)').run(d.year, d.month, d.key, d.value); break
  }
}

function getCompanyDb(id) {
  if (companyDbs[id]) return companyDbs[id]
  const dbPath = path.join(DATA_DIR, 'companies', `${id}.db`)
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS departments (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL);

    CREATE TABLE IF NOT EXISTS employees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL, position TEXT, department_id INTEGER REFERENCES departments(id),
      rate_type TEXT CHECK(rate_type IN ('hourly','monthly')) NOT NULL,
      rate REAL NOT NULL DEFAULT 0, hired_date TEXT, is_active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS timesheet_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL REFERENCES employees(id),
      date TEXT NOT NULL, code TEXT NOT NULL DEFAULT 'Я',
      hours REAL NOT NULL DEFAULT 8,
      arrival_time TEXT, departure_time TEXT, overtime_coeff REAL,
      UNIQUE(employee_id, date)
    );

    CREATE TABLE IF NOT EXISTS salary_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL REFERENCES employees(id),
      effective_from TEXT NOT NULL,
      rate_type TEXT CHECK(rate_type IN ('hourly','monthly')) NOT NULL,
      rate REAL NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      UNIQUE(employee_id, effective_from)
    );

    CREATE TABLE IF NOT EXISTS holidays (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS workdays (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

    CREATE TABLE IF NOT EXISTS month_settings (
      year  INTEGER NOT NULL,
      month INTEGER NOT NULL,
      key   TEXT    NOT NULL,
      value TEXT    NOT NULL,
      PRIMARY KEY (year, month, key)
    );

    CREATE TABLE IF NOT EXISTS advances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      year INTEGER NOT NULL, month INTEGER NOT NULL,
      amount REAL NOT NULL DEFAULT 0, given_date TEXT NOT NULL DEFAULT '',
      UNIQUE(employee_id, year, month)
    );
  `)
  companyDbs[id] = db
  return db
}

// ─── Salary calculation helpers ───────────────────────────────────────────────
function getWorkingDaysInMonth(year, month, holidayDates, workdayDates) {
  const daysInMonth = new Date(year, month, 0).getDate()
  const prefix = `${year}-${String(month).padStart(2,'0')}`
  const hSet = new Set(holidayDates)
  const wSet = new Set(workdayDates)
  let count = 0
  for (let d = 1; d <= daysInMonth; d++) {
    const dow = new Date(year, month-1, d).getDay()
    const dateStr = `${prefix}-${String(d).padStart(2,'0')}`
    const weekend = dow === 0 || dow === 6
    if (wSet.has(dateStr)) count++
    else if (!weekend && !hSet.has(dateStr)) count++
  }
  return count
}

function calcEmployeeSalary(workedRecs, derivedHourlyRate, normHours, overtimeCoeff) {
  const totalWorked = workedRecs.reduce((s, r) => s + r.hours, 0)
  const overtimeHours = Math.max(0, totalWorked - normHours)
  const regularHours = totalWorked - overtimeHours
  const salary = derivedHourlyRate * regularHours + derivedHourlyRate * overtimeCoeff * overtimeHours
  return {
    regularHours: Math.round(regularHours * 100) / 100,
    overtimeHours: Math.round(overtimeHours * 100) / 100,
    salary: Math.round(salary * 100) / 100,
  }
}

function getSetting(db, key, def) {
  return db.prepare(`SELECT value FROM settings WHERE key=?`).get(key)?.value ?? def
}

function getMonthSetting(db, year, month, key) {
  return db.prepare('SELECT value FROM month_settings WHERE year=? AND month=? AND key=?').get(year, month, key)?.value ?? null
}

function calcSalaryForEmployee(db, empRow, year, month, normDays, normHours, hoursPerDay, overtimeCoeff) {
  const prefix = `${year}-${String(month).padStart(2,'0')}`
  const monthStart = `${prefix}-01`

  const histEntry = db.prepare(
    'SELECT rate_type, rate FROM salary_history WHERE employee_id=? AND effective_from<=? ORDER BY effective_from DESC LIMIT 1'
  ).get(empRow.id, monthStart)
  const rateType = histEntry?.rate_type ?? empRow.rate_type
  const rate = histEntry?.rate ?? empRow.rate

  const rows = db.prepare('SELECT * FROM timesheet_records WHERE employee_id=? AND date LIKE ? ORDER BY date').all(empRow.id, prefix + '%')
  const workedRecs = rows.filter(r => r.code === 'Я')
  const vacationDays = rows.filter(r => r.code === 'О').length
  const sickDays = rows.filter(r => r.code === 'Б').length

  const vacationCoeff = Number(getMonthSetting(db, year, month, 'vacationCoeff') ?? 1)
  const sickCoeff = Number(getMonthSetting(db, year, month, 'sickCoeff') ?? 0)

  const derivedHourlyRate = rateType === 'hourly' ? rate : normHours > 0 ? rate / normHours : 0
  const { regularHours, overtimeHours, salary: workedSalary } = calcEmployeeSalary(workedRecs, derivedHourlyRate, normHours, overtimeCoeff)

  const perDayRate = derivedHourlyRate * hoursPerDay
  const vacationPay = Math.round(perDayRate * vacationDays * vacationCoeff * 100) / 100
  const sickPay = Math.round(perDayRate * sickDays * sickCoeff * 100) / 100
  const salary = Math.round((workedSalary + vacationPay + sickPay) * 100) / 100
  const regularSalary = Math.round(derivedHourlyRate * regularHours * 100) / 100
  const overtimeSalary = Math.round((workedSalary - regularSalary) * 100) / 100

  return {
    rateType, rate, derivedHourlyRate: Math.round(derivedHourlyRate * 100) / 100,
    vacationCoeff, sickCoeff,
    rows, workedRecs, workedDays: workedRecs.length,
    regularHours, overtimeHours,
    workedHours: Math.round((regularHours + overtimeHours) * 100) / 100,
    vacationDays, sickDays, regularSalary, overtimeSalary, vacationPay, sickPay, salary,
  }
}

// ─── Express app ──────────────────────────────────────────────────────────────
const app = express()
app.use(cors())
app.use(express.json())

// ─── Companies CRUD ───────────────────────────────────────────────────────────
app.get('/companies', (req, res) => {
  res.json(listCompanies().map(c => ({
    id: c.id, name: c.name, currency: c.currency,
    createdAt: c.created_at, lastOpenedAt: c.last_opened_at
  })))
})

app.post('/companies', (req, res) => {
  const { name, currency = '₴' } = req.body
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
  const now = new Date().toISOString()
  masterDb.prepare('INSERT INTO companies (id,name,currency,created_at,last_opened_at) VALUES (?,?,?,?,?)').run(id, name, currency, now, now)
  getCompanyDb(id) // create the company DB
  res.json({ id, name, currency, createdAt: now, lastOpenedAt: now })
})

app.put('/companies/:id', (req, res) => {
  const { name, currency } = req.body
  masterDb.prepare('UPDATE companies SET name=?, currency=? WHERE id=?').run(name, currency, req.params.id)
  res.json({ ok: true })
})

app.delete('/companies/:id', (req, res) => {
  const id = req.params.id
  masterDb.prepare('DELETE FROM companies WHERE id=?').run(id)
  if (companyDbs[id]) { companyDbs[id].close(); delete companyDbs[id] }
  const dbPath = path.join(DATA_DIR, 'companies', `${id}.db`)
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath)
  res.json({ ok: true })
})

app.post('/companies/:id/open', (req, res) => {
  const now = new Date().toISOString()
  masterDb.prepare('UPDATE companies SET last_opened_at=? WHERE id=?').run(now, req.params.id)
  res.json({ ok: true })
})

// ─── Company middleware ────────────────────────────────────────────────────────
app.use('/companies/:id', (req, res, next) => {
  const c = getCompany(req.params.id)
  if (!c) return res.status(404).json({ error: 'Company not found' })
  req.db = getCompanyDb(req.params.id)
  req.companyId = req.params.id
  next()
})

// ─── SSE events ───────────────────────────────────────────────────────────────
app.get('/companies/:id/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()
  const id = req.params.id
  if (!sseClients.has(id)) sseClients.set(id, new Set())
  sseClients.get(id).add(res)
  const hb = setInterval(() => { try { res.write(':hb\n\n') } catch {} }, 25000)
  req.on('close', () => { clearInterval(hb); sseClients.get(id)?.delete(res) })
})

// ─── Departments ──────────────────────────────────────────────────────────────
app.get('/companies/:id/departments', (req, res) => {
  res.json(req.db.prepare('SELECT * FROM departments ORDER BY name').all())
})
app.post('/companies/:id/departments', (req, res) => {
  const r = req.db.prepare('INSERT INTO departments (name) VALUES (?)').run(req.body.name)
  appendAudit(req.companyId, 'department.create', { id: r.lastInsertRowid, name: req.body.name })
  broadcast(req.companyId)
  res.json({ id: r.lastInsertRowid, name: req.body.name })
})
app.delete('/companies/:id/departments/:did', (req, res) => {
  req.db.prepare('DELETE FROM departments WHERE id=?').run(req.params.did)
  appendAudit(req.companyId, 'department.delete', { id: Number(req.params.did) })
  broadcast(req.companyId)
  res.json({ ok: true })
})

// ─── Employees ────────────────────────────────────────────────────────────────
function mapEmployee(e) {
  return {
    id: e.id,
    fullName: e.full_name,
    position: e.position,
    departmentId: e.department_id,
    departmentName: e.department_name ?? null,
    rateType: e.rate_type,
    rate: e.rate,
    hiredDate: e.hired_date ?? null,
    isActive: e.is_active === 1
  }
}

app.get('/companies/:id/employees', (req, res) => {
  res.json(req.db.prepare(`
    SELECT e.*, d.name AS department_name FROM employees e
    LEFT JOIN departments d ON d.id=e.department_id ORDER BY e.full_name
  `).all().map(mapEmployee))
})
app.post('/companies/:id/employees', (req, res) => {
  const b = req.body
  const db = req.db
  const effectiveFrom = b.hiredDate || '2000-01-01'
  const insertEmp = db.prepare(`
    INSERT INTO employees (full_name,position,department_id,rate_type,rate,hired_date,is_active)
    VALUES (?,?,?,?,?,?,1)
  `)
  const insertHist = db.prepare(`
    INSERT OR IGNORE INTO salary_history (employee_id,effective_from,rate_type,rate,note)
    VALUES (?,?,?,?,?)
  `)
  let empId
  let histId = 0
  db.transaction(() => {
    const r = insertEmp.run(b.fullName, b.position||'', b.departmentId||null, b.rateType, b.rate, b.hiredDate||null)
    empId = r.lastInsertRowid
    const hr = insertHist.run(empId, effectiveFrom, b.rateType, b.rate, '')
    histId = hr.lastInsertRowid
  })()
  appendAudit(req.companyId, 'employee.create', { id: empId, fullName: b.fullName, position: b.position||'', departmentId: b.departmentId||null, rateType: b.rateType, rate: b.rate, hiredDate: b.hiredDate||null })
  if (histId > 0) appendAudit(req.companyId, 'salaryHistory.add', { id: histId, employeeId: empId, effectiveFrom, rateType: b.rateType, rate: b.rate, note: '' })
  broadcast(req.companyId)
  res.json({ id: empId, ...b, isActive: true })
})
app.put('/companies/:id/employees/:eid', (req, res) => {
  const b = req.body
  req.db.prepare(`UPDATE employees SET full_name=?,position=?,department_id=?,rate_type=?,rate=?,hired_date=?,is_active=? WHERE id=?`)
    .run(b.fullName, b.position||'', b.departmentId||null, b.rateType, b.rate, b.hiredDate||null, b.isActive?1:0, req.params.eid)
  appendAudit(req.companyId, 'employee.update', { id: Number(req.params.eid), ...b })
  broadcast(req.companyId)
  res.json({ id: Number(req.params.eid), ...b })
})
app.delete('/companies/:id/employees/:eid', (req, res) => {
  req.db.prepare('UPDATE employees SET is_active=0 WHERE id=?').run(req.params.eid)
  appendAudit(req.companyId, 'employee.deactivate', { id: Number(req.params.eid) })
  broadcast(req.companyId)
  res.json({ ok: true })
})

// ─── Timesheet ────────────────────────────────────────────────────────────────
app.get('/companies/:id/timesheet/:year/:month', (req, res) => {
  const { year, month } = req.params
  const prefix = `${year}-${String(month).padStart(2,'0')}`
  res.json(req.db.prepare('SELECT * FROM timesheet_records WHERE date LIKE ?').all(prefix+'%').map(r => ({
    id: r.id, employeeId: r.employee_id, date: r.date, code: r.code,
    hours: r.hours, arrivalTime: r.arrival_time ?? undefined,
    departureTime: r.departure_time ?? undefined, overtimeCoeff: r.overtime_coeff ?? undefined,
  })))
})
app.post('/companies/:id/timesheet/record', (req, res) => {
  const b = req.body
  req.db.prepare(`INSERT INTO timesheet_records (employee_id,date,code,hours,arrival_time,departure_time,overtime_coeff)
    VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(employee_id,date) DO UPDATE SET code=excluded.code,hours=excluded.hours,
    arrival_time=excluded.arrival_time,departure_time=excluded.departure_time,overtime_coeff=excluded.overtime_coeff`)
    .run(b.employeeId, b.date, b.code, b.hours, b.arrivalTime||null, b.departureTime||null, b.overtimeCoeff||null)
  appendAudit(req.companyId, 'timesheet.save', { employeeId: b.employeeId, date: b.date, code: b.code, hours: b.hours, arrivalTime: b.arrivalTime||null, departureTime: b.departureTime||null, overtimeCoeff: b.overtimeCoeff||null })
  broadcast(req.companyId)
  res.json({ ok: true })
})
app.delete('/companies/:id/timesheet/record/:empId/:date', (req, res) => {
  req.db.prepare('DELETE FROM timesheet_records WHERE employee_id=? AND date=?').run(req.params.empId, req.params.date)
  appendAudit(req.companyId, 'timesheet.delete', { employeeId: Number(req.params.empId), date: req.params.date })
  broadcast(req.companyId)
  res.json({ ok: true })
})
app.post('/companies/:id/timesheet/bulk', (req, res) => {
  const insert = req.db.prepare(`
    INSERT INTO timesheet_records (employee_id,date,code,hours,arrival_time,departure_time,overtime_coeff)
    VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(employee_id,date) DO UPDATE SET
      code=excluded.code, hours=excluded.hours,
      arrival_time=excluded.arrival_time, departure_time=excluded.departure_time,
      overtime_coeff=excluded.overtime_coeff
  `)
  const many = req.db.transaction((records) => {
    for (const r of records) insert.run(r.employeeId,r.date,r.code,r.hours,r.arrivalTime||null,r.departureTime||null,r.overtimeCoeff||null)
  })
  many(req.body)
  broadcast(req.companyId)
  res.json({ ok: true })
})

// ─── Salary history ───────────────────────────────────────────────────────────
app.get('/companies/:id/salary-history/:empId', (req, res) => {
  res.json(req.db.prepare('SELECT * FROM salary_history WHERE employee_id=? ORDER BY effective_from DESC').all(req.params.empId).map(r => ({
    id: r.id, employeeId: r.employee_id, effectiveFrom: r.effective_from,
    rateType: r.rate_type, rate: r.rate, note: r.note,
  })))
})
app.post('/companies/:id/salary-history', (req, res) => {
  const b = req.body
  const r = req.db.prepare('INSERT OR REPLACE INTO salary_history (employee_id,effective_from,rate_type,rate,note) VALUES (?,?,?,?,?)').run(b.employeeId, b.effectiveFrom, b.rateType, b.rate, b.note||'')
  appendAudit(req.companyId, 'salaryHistory.add', { id: r.lastInsertRowid, ...b })
  broadcast(req.companyId)
  res.json({ id: r.lastInsertRowid, ...b })
})
app.delete('/companies/:id/salary-history/:histId', (req, res) => {
  const empId = req.query.employeeId
  const rows = req.db.prepare('SELECT COUNT(*) AS cnt FROM salary_history WHERE employee_id=?').get(empId)
  if (rows.cnt <= 1) return res.status(400).json({ error: 'Cannot delete last rate record' })
  req.db.prepare('DELETE FROM salary_history WHERE id=?').run(req.params.histId)
  appendAudit(req.companyId, 'salaryHistory.delete', { id: Number(req.params.histId), employeeId: Number(empId) })
  broadcast(req.companyId)
  res.json({ ok: true })
})

// ─── Holidays / Workdays ──────────────────────────────────────────────────────
app.get('/companies/:id/holidays/:year/:month', (req, res) => {
  const prefix = `${req.params.year}-${String(req.params.month).padStart(2,'0')}`
  res.json(req.db.prepare('SELECT date FROM holidays WHERE date LIKE ?').all(prefix+'%').map(r => r.date))
})
app.post('/companies/:id/holidays/toggle', (req, res) => {
  const { date } = req.body
  const existing = req.db.prepare('SELECT id FROM holidays WHERE date=?').get(date)
  if (existing) {
    req.db.prepare('DELETE FROM holidays WHERE date=?').run(date)
    appendAudit(req.companyId, 'holiday.toggle', { date, active: false })
    broadcast(req.companyId); res.json({ active: false })
  } else {
    req.db.prepare('INSERT INTO holidays (date) VALUES (?)').run(date)
    appendAudit(req.companyId, 'holiday.toggle', { date, active: true })
    broadcast(req.companyId); res.json({ active: true })
  }
})
app.get('/companies/:id/workdays/:year/:month', (req, res) => {
  const prefix = `${req.params.year}-${String(req.params.month).padStart(2,'0')}`
  res.json(req.db.prepare('SELECT date FROM workdays WHERE date LIKE ?').all(prefix+'%').map(r => r.date))
})
app.post('/companies/:id/workdays/toggle', (req, res) => {
  const { date } = req.body
  const existing = req.db.prepare('SELECT id FROM workdays WHERE date=?').get(date)
  if (existing) {
    req.db.prepare('DELETE FROM workdays WHERE date=?').run(date)
    appendAudit(req.companyId, 'workday.toggle', { date, active: false })
    broadcast(req.companyId); res.json({ active: false })
  } else {
    req.db.prepare('INSERT INTO workdays (date) VALUES (?)').run(date)
    appendAudit(req.companyId, 'workday.toggle', { date, active: true })
    broadcast(req.companyId); res.json({ active: true })
  }
})

// ─── Month settings ───────────────────────────────────────────────────────────
app.get('/companies/:id/month-settings/:year/:month/:key', (req, res) => {
  const { year, month, key } = req.params
  const row = req.db.prepare('SELECT value FROM month_settings WHERE year=? AND month=? AND key=?').get(Number(year), Number(month), key)
  res.json(row ? Number(row.value) : null)
})
app.put('/companies/:id/month-settings/:year/:month/:key', (req, res) => {
  const { year, month, key } = req.params
  const value = String(req.body.value)
  req.db.prepare('INSERT OR REPLACE INTO month_settings (year,month,key,value) VALUES (?,?,?,?)').run(Number(year), Number(month), key, value)
  appendAudit(req.companyId, 'monthSettings.set', { year: Number(year), month: Number(month), key, value })
  broadcast(req.companyId)
  res.json({ ok: true })
})

// ─── Salary summary ───────────────────────────────────────────────────────────
app.get('/companies/:id/salary/:year/:month', (req, res) => {
  const db = req.db
  const { year, month } = req.params
  const y = Number(year), m = Number(month)
  const prefix = `${year}-${String(m).padStart(2,'0')}`

  const holidays = db.prepare('SELECT date FROM holidays WHERE date LIKE ?').all(prefix+'%').map(r=>r.date)
  const workdays = db.prepare('SELECT date FROM workdays WHERE date LIKE ?').all(prefix+'%').map(r=>r.date)
  const normDays = getWorkingDaysInMonth(y, m, holidays, workdays)
  const hoursPerDay = Number(getSetting(db, 'workHoursPerDay', '8'))
  const normHours = normDays * hoursPerDay
  const overtimeCoeff = Number(getMonthSetting(db, y, m, 'overtimeCoeff') ?? getSetting(db, 'overtimeCoeff', '1.5'))

  const employees = db.prepare(`
    SELECT e.*, d.name AS department_name FROM employees e
    LEFT JOIN departments d ON d.id=e.department_id
    WHERE e.is_active=1 ORDER BY e.full_name
  `).all()

  res.json(employees.map(emp => {
    const s = calcSalaryForEmployee(db, emp, y, m, normDays, normHours, hoursPerDay, overtimeCoeff)
    const advRow = db.prepare('SELECT amount, given_date FROM advances WHERE employee_id=? AND year=? AND month=?').get(emp.id, y, m)
    return {
      employee: {
        id: emp.id, fullName: emp.full_name, position: emp.position,
        departmentId: emp.department_id, departmentName: emp.department_name,
        rateType: emp.rate_type, rate: emp.rate, hiredDate: emp.hired_date,
        isActive: true
      },
      normDays,
      effectiveRate: s.rate, effectiveRateType: s.rateType,
      derivedHourlyRate: s.derivedHourlyRate,
      workedDays: s.workedDays, workedHours: s.workedHours,
      overtimeHours: s.overtimeHours,
      vacationDays: s.vacationDays, sickDays: s.sickDays,
      vacationPay: s.vacationPay, sickPay: s.sickPay, salary: s.salary,
      advance: advRow?.amount ?? 0, advanceDate: advRow?.given_date ?? '',
    }
  }))
})

// ─── Salary detail ────────────────────────────────────────────────────────────
app.get('/companies/:id/salary/:year/:month/detail/:empId', (req, res) => {
  const db = req.db
  const { year, month, empId } = req.params
  const y = Number(year), m = Number(month)
  const prefix = `${year}-${String(m).padStart(2,'0')}`

  const emp = db.prepare('SELECT * FROM employees WHERE id=?').get(Number(empId))
  if (!emp) return res.json(null)

  const holidays = db.prepare('SELECT date FROM holidays WHERE date LIKE ?').all(prefix+'%').map(r=>r.date)
  const workdays = db.prepare('SELECT date FROM workdays WHERE date LIKE ?').all(prefix+'%').map(r=>r.date)
  const normDays = getWorkingDaysInMonth(y, m, holidays, workdays)
  const hoursPerDay = Number(getSetting(db, 'workHoursPerDay', '8'))
  const normHours = normDays * hoursPerDay
  const overtimeCoeff = Number(getMonthSetting(db, y, m, 'overtimeCoeff') ?? getSetting(db, 'overtimeCoeff', '1.5'))

  const s = calcSalaryForEmployee(db, emp, y, m, normDays, normHours, hoursPerDay, overtimeCoeff)

  const records = s.rows.map(r => ({
    date: r.date, code: r.code,
    arrivalTime: r.arrival_time ?? undefined,
    departureTime: r.departure_time ?? undefined,
    hours: r.hours, regularHours: r.hours, overtimeHours: 0, overtimeCoeff,
  }))

  const advRow = db.prepare('SELECT amount, given_date FROM advances WHERE employee_id=? AND year=? AND month=?').get(Number(empId), y, m)
  res.json({
    employee: { id: emp.id, fullName: emp.full_name, position: emp.position },
    year: y, month: m, normDays, normHours, hoursPerDay,
    globalOvertimeCoeff: overtimeCoeff,
    vacationCoeff: s.vacationCoeff, sickCoeff: s.sickCoeff,
    effectiveRate: s.rate, effectiveRateType: s.rateType,
    derivedHourlyRate: s.derivedHourlyRate,
    records,
    workedDays: s.workedDays, regularHours: s.regularHours,
    overtimeHours: s.overtimeHours, workedHours: s.workedHours,
    vacationDays: s.vacationDays, sickDays: s.sickDays,
    regularSalary: s.regularSalary, overtimeSalary: s.overtimeSalary,
    vacationPay: s.vacationPay, sickPay: s.sickPay, salary: s.salary,
    advance: advRow?.amount ?? 0, advanceDate: advRow?.given_date ?? '',
  })
})

// ─── Advances ────────────────────────────────────────────────────────────────
app.put('/companies/:id/advances/:year/:month/:empId', (req, res) => {
  const { year, month, empId } = req.params
  const { amount, givenDate } = req.body
  const y = Number(year), m = Number(month), eid = Number(empId)
  if (!amount || amount <= 0) {
    req.db.prepare('DELETE FROM advances WHERE employee_id=? AND year=? AND month=?').run(eid, y, m)
  } else {
    req.db.prepare('INSERT OR REPLACE INTO advances (employee_id,year,month,amount,given_date) VALUES (?,?,?,?,?)').run(eid, y, m, amount, givenDate || '')
  }
  broadcast(req.companyId)
  res.json({ ok: true })
})

// ─── Excel export ─────────────────────────────────────────────────────────────
app.get('/companies/:id/export/excel/:year/:month', async (req, res) => {
  const db = req.db
  const { year, month } = req.params
  const lang = req.query.lang || 'uk'
  const y = Number(year), m = Number(month)
  const prefix = `${year}-${String(m).padStart(2,'0')}`
  const daysInMonth = new Date(y, m, 0).getDate()

  const MONTHS = { ru:['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'], uk:['Січень','Лютий','Березень','Квітень','Травень','Червень','Липень','Серпень','Вересень','Жовтень','Листопад','Грудень'], en:['January','February','March','April','May','June','July','August','September','October','November','December'] }
  const months = MONTHS[lang] || MONTHS.uk
  const colNames = { ru:{name:'ФИО',pos:'Должность',days:'Дн.',hours:'Час.',total:'ИТОГО:'}, uk:{name:'ПІБ',pos:'Посада',days:'Дн.',hours:'Год.',total:'РАЗОМ:'}, en:{name:'Full name',pos:'Position',days:'Days',hours:'Hours',total:'TOTAL:'} }
  const cn = colNames[lang] || colNames.uk

  const employees = db.prepare('SELECT * FROM employees WHERE is_active=1 ORDER BY full_name').all()
  const records = db.prepare('SELECT * FROM timesheet_records WHERE date LIKE ?').all(prefix+'%')

  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet(`${months[m-1]} ${year}`)
  const headerRow = ws.addRow(['№', cn.name, cn.pos, ...Array.from({length:daysInMonth},(_,i)=>i+1), cn.days, cn.hours])
  headerRow.font = { bold: true }
  headerRow.alignment = { horizontal:'center', vertical:'middle', wrapText:true }
  ws.getColumn(1).width=5; ws.getColumn(2).width=28; ws.getColumn(3).width=18
  for (let ci=4; ci<=3+daysInMonth; ci++) ws.getColumn(ci).width=5
  ws.getColumn(4+daysInMonth).width=7; ws.getColumn(5+daysInMonth).width=7

  employees.forEach((emp, idx) => {
    const empRecs = records.filter(r => r.employee_id === emp.id)
    const days = []; let workedDays=0, workedHours=0
    for (let d=1; d<=daysInMonth; d++) {
      const dateStr = `${prefix}-${String(d).padStart(2,'0')}`
      const rec = empRecs.find(r => r.date===dateStr)
      if (rec) {
        const isWorked = rec.code==='Я'
        days.push(isWorked ? (rec.hours%1===0?rec.hours:rec.hours.toFixed(1)) : rec.code)
        if (isWorked) { workedDays++; workedHours+=rec.hours }
      } else {
        const dow = new Date(y, m-1, d).getDay()
        days.push(dow===0||dow===6?'В':'')
      }
    }
    const row = ws.addRow([idx+1, emp.full_name, emp.position, ...days, workedDays, workedHours])
    row.alignment = { horizontal:'center', vertical:'middle' }
    row.getCell(2).alignment = { horizontal:'left', vertical:'middle' }
    row.getCell(3).alignment = { horizontal:'left', vertical:'middle' }
  })

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', `attachment; filename="timesheet_${year}_${String(m).padStart(2,'0')}.xlsx"`)
  await wb.xlsx.write(res)
})

// ─── PDF / HTML export ────────────────────────────────────────────────────────
app.get('/companies/:id/export/pdf/:year/:month', (req, res) => {
  const db = req.db
  const { year, month } = req.params
  const lang = req.query.lang || 'uk'
  const y = Number(year), m = Number(month)
  const prefix = `${year}-${String(m).padStart(2,'0')}`
  const daysInMonth = new Date(y, m, 0).getDate()

  const MONTHS = { ru:['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'], uk:['Січень','Лютий','Березень','Квітень','Травень','Червень','Липень','Серпень','Вересень','Жовтень','Листопад','Грудень'], en:['January','February','March','April','May','June','July','August','September','October','November','December'] }
  const WD = { ru:['Вс','Пн','Вт','Ср','Чт','Пт','Сб'], uk:['Нд','Пн','Вт','Ср','Чт','Пт','Сб'], en:['Su','Mo','Tu','We','Th','Fr','Sa'] }
  const months = MONTHS[lang]||MONTHS.uk
  const wd = WD[lang]||WD.uk

  const company = getCompany(req.params.id)
  const employees = db.prepare('SELECT * FROM employees WHERE is_active=1 ORDER BY full_name').all()
  const records = db.prepare('SELECT * FROM timesheet_records WHERE date LIKE ?').all(prefix+'%')

  const dayHeaders = Array.from({length:daysInMonth},(_,i)=>{
    const d=i+1, dow=new Date(y,m-1,d).getDay(), isWknd=dow===0||dow===6
    return `<th style="width:20px;${isWknd?'background:#f5f5f5;':''}${isWknd?'color:#aaa;':''}">${d}<br/><span style="font-size:7px">${wd[dow]}</span></th>`
  }).join('')

  const CODE_COLORS = {'Я':'#e6f7ff','О':'#fff7e6','Б':'#fff1f0','ОЗ':'#f0f0f0','Н':'#fffbe6','НН':'#ffccc7'}

  const rows = employees.map((emp,idx)=>{
    const empRecs = records.filter(r=>r.employee_id===emp.id)
    let workedDays=0,workedHours=0
    const cells = Array.from({length:daysInMonth},(_,ci)=>{
      const d=ci+1,dow=new Date(y,m-1,d).getDay(),isWknd=dow===0||dow===6
      const dateStr=`${prefix}-${String(d).padStart(2,'0')}`
      const rec=empRecs.find(r=>r.date===dateStr)
      const code=rec?.code||(isWknd?'В':'')
      const bg=CODE_COLORS[code]??''
      if(rec&&rec.code==='Я'){workedDays++;workedHours+=rec.hours}
      const isWorked=rec&&rec.code==='Я'
      const cellText=isWorked?(rec.hours%1===0?String(rec.hours):rec.hours.toFixed(1)):code
      return `<td style="${bg?`background:${bg};`:(isWknd&&!rec?'background:#f9f9f9;':'')}font-size:8px;">${cellText}</td>`
    }).join('')
    return `<tr style="${idx%2===1?'background:#fafafa;':''}"><td>${idx+1}</td><td style="text-align:left;padding-left:4px;">${emp.full_name}</td><td style="text-align:left;padding-left:4px;font-size:8px;color:#555">${emp.position??''}</td>${cells}<td style="font-weight:bold">${workedDays}</td><td style="font-weight:bold">${workedHours%1===0?workedHours:workedHours.toFixed(1)}</td></tr>`
  }).join('')

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
*{box-sizing:border-box;margin:0;padding:0;}body{font-family:Arial,sans-serif;font-size:9px;}
table{width:100%;border-collapse:collapse;table-layout:fixed;}
th,td{border:1px solid #bbb;padding:2px 1px;text-align:center;}th{background:#e8e8e8;font-weight:bold;}
@page{size:A4 landscape;margin:8mm 10mm;}
@media print{*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;}}
</style></head><body>
<div style="text-align:center;margin-bottom:10px;"><h2 style="font-size:13px">${company.name} — ${months[m-1]} ${year}</h2></div>
<table><colgroup><col style="width:24px"/><col style="width:150px"/><col style="width:100px"/>${Array.from({length:daysInMonth},()=>'<col style="width:20px"/>').join('')}<col style="width:30px"/><col style="width:30px"/></colgroup>
<thead><tr><th>№</th><th>ПІБ</th><th>Посада</th>${dayHeaders}<th>Дн.</th><th>Год.</th></tr></thead>
<tbody>${rows}</tbody></table>
<script>window.print()</script></body></html>`

  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.send(html)
})

app.get('/companies/:id/export/detail-pdf/:year/:month/:empId', (req, res) => {
  const db = req.db
  const { year, month, empId } = req.params
  const lang = req.query.lang || 'uk'
  const colorMode = req.query.colorMode || 'color'
  const y = Number(year), m = Number(month)
  const prefix = `${year}-${String(m).padStart(2,'0')}`

  const emp = db.prepare('SELECT * FROM employees WHERE id=?').get(Number(empId))
  if (!emp) return res.status(404).json({ error: 'Not found' })

  const holidays = db.prepare('SELECT date FROM holidays WHERE date LIKE ?').all(prefix+'%').map(r=>r.date)
  const workdays2 = db.prepare('SELECT date FROM workdays WHERE date LIKE ?').all(prefix+'%').map(r=>r.date)
  const normDays = getWorkingDaysInMonth(y, m, holidays, workdays2)
  const hoursPerDay = Number(getSetting(db,'workHoursPerDay','8'))
  const normHours = normDays * hoursPerDay
  const overtimeCoeff = Number(getMonthSetting(db,y,m,'overtimeCoeff')??getSetting(db,'overtimeCoeff','1.5'))

  const s = calcSalaryForEmployee(db, emp, y, m, normDays, normHours, hoursPerDay, overtimeCoeff)
  const company = getCompany(req.params.id)

  const MONTHS = { ru:['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'], uk:['Січень','Лютий','Березень','Квітень','Травень','Червень','Липень','Серпень','Вересень','Жовтень','Листопад','Грудень'], en:['January','February','March','April','May','June','July','August','September','October','November','December'] }
  const months = MONTHS[lang]||MONTHS.uk
  const bw = colorMode==='bw'
  const fmt2 = (n) => n.toLocaleString('uk-UA', {minimumFractionDigits:2, maximumFractionDigits:2})
  const fmtH = (n) => Number.isInteger(n)?String(n):n.toFixed(2).replace(/\.?0+$/,'')

  const CODE_COLORS = {'Я':'#e6f7ff','О':'#fff7e6','Б':'#fff1f0','ОЗ':'#f0f0f0','Н':'#fffbe6','НН':'#ffccc7'}

  const attendRows = s.rows.map((r,idx)=>{
    const isWorked=r.code==='Я'
    const dow=new Date(r.date).getDay(), isWknd=dow===0||dow===6
    const dateStr=new Date(r.date).toLocaleDateString('uk-UA',{day:'2-digit',month:'2-digit',weekday:'short'})
    let rowStyle=''
    if(bw){ if(isWorked)rowStyle=idx%2===0?'background:#f0f0f0;':'background:#e4e4e4;'; else if(isWknd)rowStyle='background:#d8d8d8;color:#555;'; else rowStyle=idx%2===1?'background:#fafafa;':''; }
    else { const bg=CODE_COLORS[r.code]??''; rowStyle=bg?`background:${bg};`:(isWknd&&!bg?'background:#f9f9f9;':(idx%2===1?'background:#fafafa;':'')); }
    return `<tr style="${rowStyle}"><td>${idx+1}</td><td style="text-align:left">${dateStr}</td><td><b>${r.code}</b></td><td>${r.arrival_time??'—'}</td><td>${r.departure_time??'—'}</td><td style="text-align:right">${isWorked?`<b>${fmtH(r.hours)}</b>`:'—'}</td></tr>`
  }).join('')

  const overtimeLine = s.overtimeHours>0?`<div style="margin-bottom:4px;font-size:8.5px;${bw?'font-style:italic;':'color:#d46b08;'}">Переробіток (×${overtimeCoeff}): ${fmt2(s.derivedHourlyRate)} × ${fmtH(s.overtimeHours)} год = <b>${fmt2(s.overtimeSalary)}</b></div>`:''
  const vacLine = s.vacationDays>0?`<div style="margin-bottom:4px;font-size:8.5px;${bw?'':'color:#d48b08;'}">Відпускні (${s.vacationDays} дн., ×${s.vacationCoeff}) = <b>${fmt2(s.vacationPay)}</b></div>`:''
  const sickLine = s.sickDays>0?`<div style="margin-bottom:4px;font-size:8.5px;${bw?'':'color:#cf1322;'}">Лікарняні (${s.sickDays} дн., ×${s.sickCoeff}) = <b>${fmt2(s.sickPay)}</b></div>`:''

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
*{box-sizing:border-box;margin:0;padding:0;}body{font-family:Arial,sans-serif;font-size:8.5px;color:#222;}
table{width:100%;border-collapse:collapse;margin-bottom:10px;}
th,td{border:1px solid ${bw?'#888':'#ccc'};padding:2px 4px;text-align:center;}
th{background:${bw?'#d0d0d0':'#efefef'};font-size:8px;font-weight:bold;}td{font-size:8px;}
.calc{${bw?'border:2px solid #333;':'background:#f6ffed;border:1px solid #b7eb8f;'}border-radius:4px;padding:8px 12px;}
@page{size:A4 portrait;margin:8mm 10mm;}
@media print{*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;}}
</style></head><body>
<div style="text-align:center;border-bottom:2px solid #333;padding-bottom:7px;margin-bottom:10px;">
  <h1 style="font-size:13px">${company.name}</h1>
  <div style="font-size:10px;color:#555">Розрахунок зарплати — ${months[m-1]} ${year}</div>
  <div style="font-size:11px;font-weight:600;margin-top:3px">${emp.full_name}${emp.position?` — ${emp.position}`:''}</div>
</div>
<table><thead><tr><th style="width:20px">№</th><th>Дата</th><th style="width:28px">Код</th><th style="width:42px">Прихід</th><th style="width:42px">Відхід</th><th style="width:36px">Год.</th></tr></thead><tbody>${attendRows}</tbody></table>
<div class="calc">
  <div style="font-size:8px;font-weight:bold;text-transform:uppercase;border-bottom:${bw?'2px solid #333':'1px solid #ddd'};padding-bottom:2px;margin-bottom:6px">Розрахунок</div>
  <div style="margin-bottom:4px;font-size:8.5px">Звичайні години: ${fmt2(s.derivedHourlyRate)} × ${fmtH(s.regularHours)} год = <b>${fmt2(s.regularSalary)}</b></div>
  ${overtimeLine}${vacLine}${sickLine}
  <hr style="border:none;border-top:${bw?'2px solid #333':'1px solid #b7eb8f'};margin:6px 0;"/>
  <div style="font-size:16px;font-weight:bold;${bw?'text-decoration:underline;':'color:#1677ff;'}">До виплати: ${fmt2(s.salary)} ${company.currency}</div>
</div>
<script>window.print()</script></body></html>`

  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.send(html)
})

// ─── Salary summary export ─────────────────────────────────────────────────────
app.get('/companies/:id/export/salary-excel/:year/:month', async (req, res) => {
  const db = req.db
  const { year, month } = req.params
  const lang = req.query.lang || 'uk'
  const y = Number(year), m = Number(month)
  const prefix = `${year}-${String(m).padStart(2,'0')}`
  const monthStart = `${prefix}-01`

  const MONTHS = { ru:['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'], uk:['Січень','Лютий','Березень','Квітень','Травень','Червень','Липень','Серпень','Вересень','Жовтень','Листопад','Грудень'], en:['January','February','March','April','May','June','July','August','September','October','November','December'] }
  const months = MONTHS[lang] || MONTHS.uk
  const I = {
    ru: { title:'Ведомость заработной платы', colName:'ФИО', colPos:'Должность', colWDays:'Отраб. дн.', colWHours:'Отраб. ч.', colOT:'Перераб. ч.', colVDays:'Отпуск дн.', colSDays:'Больн. дн.', colSal:'Зарплата', colVPay:'Отпускные', colSPay:'Больничные', colTotal:'Итого', total:'ИТОГО:' },
    uk: { title:'Відомість заробітної плати', colName:'ПІБ', colPos:'Посада', colWDays:'Відпрац. дн.', colWHours:'Відпрац. год.', colOT:'Переробіт. год.', colVDays:'Відпустка дн.', colSDays:'Ліка-рняні дн.', colSal:'Зарплата', colVPay:'Відпускні', colSPay:'Лікарняні', colTotal:'Всього', total:'РАЗОМ:' },
    en: { title:'Payroll', colName:'Full name', colPos:'Position', colWDays:'Worked days', colWHours:'Worked hrs.', colOT:'Overtime hrs.', colVDays:'Vacation days', colSDays:'Sick days', colSal:'Salary', colVPay:'Vac. pay', colSPay:'Sick pay', colTotal:'Total', total:'TOTAL:' },
  }
  const i = I[lang] || I.uk

  const holidayDates = db.prepare('SELECT date FROM holidays WHERE date LIKE ?').all(prefix+'%').map(r=>r.date)
  const workdayDates = db.prepare('SELECT date FROM workdays WHERE date LIKE ?').all(prefix+'%').map(r=>r.date)
  const daysInMonth = new Date(y, m, 0).getDate()
  const holidaySet = new Set(holidayDates), workdaySet = new Set(workdayDates)
  let normDays = 0
  for (let d = 1; d <= daysInMonth; d++) {
    const dow = new Date(y, m-1, d).getDay()
    const ds = `${prefix}-${String(d).padStart(2,'0')}`
    if (workdaySet.has(ds)) normDays++
    else if (dow !== 0 && dow !== 6 && !holidaySet.has(ds)) normDays++
  }
  const hoursPerDay = Number((db.prepare("SELECT value FROM settings WHERE key='workHoursPerDay'").get() || {value:'8'}).value)
  const normHours = normDays * hoursPerDay
  const otCoeffRow = db.prepare('SELECT value FROM month_settings WHERE year=? AND month=? AND key=?').get(y, m, 'overtimeCoeff')
  const globalOT = otCoeffRow ? Number(otCoeffRow.value) : Number((db.prepare("SELECT value FROM settings WHERE key='overtimeCoeff'").get() || {value:'1.5'}).value)
  const vacCoeffRow = db.prepare('SELECT value FROM month_settings WHERE year=? AND month=? AND key=?').get(y, m, 'vacationCoeff')
  const vacCoeff = vacCoeffRow ? Number(vacCoeffRow.value) : 1
  const sickCoeffRow = db.prepare('SELECT value FROM month_settings WHERE year=? AND month=? AND key=?').get(y, m, 'sickCoeff')
  const sickCoeff = sickCoeffRow ? Number(sickCoeffRow.value) : 0

  const employees = db.prepare('SELECT * FROM employees WHERE is_active=1 ORDER BY full_name').all()
  const records = db.prepare('SELECT * FROM timesheet_records WHERE date LIKE ?').all(prefix+'%')

  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet(`${months[m-1]} ${year}`)
  ws.mergeCells('A1', 'L1')
  const tc = ws.getCell('A1'); tc.value = `${i.title} — ${months[m-1]} ${year}`; tc.font = {bold:true,size:13}; tc.alignment = {horizontal:'center'}; ws.getRow(1).height = 22
  const hr = ws.addRow(['№', i.colName, i.colPos, i.colWDays, i.colWHours, i.colOT, i.colVDays, i.colSDays, i.colSal, i.colVPay, i.colSPay, i.colTotal])
  hr.font = {bold:true}; hr.alignment = {horizontal:'center',vertical:'middle',wrapText:true}; hr.height = 36
  ws.getColumn(1).width=5; ws.getColumn(2).width=28; ws.getColumn(3).width=18
  for (let c=4;c<=12;c++) ws.getColumn(c).width=11

  let twDays=0,twHours=0,tOT=0,tvDays=0,tsDays=0,tSal=0,tvPay=0,tsPay=0,tTotal=0
  employees.forEach((emp,idx) => {
    const hist = db.prepare('SELECT rate_type,rate FROM salary_history WHERE employee_id=? AND effective_from<=? ORDER BY effective_from DESC LIMIT 1').get(emp.id, monthStart)
    const rateType = hist?.rate_type || emp.rate_type, rate = hist?.rate || emp.rate
    const dr = rateType==='hourly' ? rate : normHours>0 ? rate/normHours : 0
    const er = records.filter(r=>r.employee_id===emp.id)
    const wr = er.filter(r=>r.code==='Я')
    const vd = er.filter(r=>r.code==='О').length, sd = er.filter(r=>r.code==='Б').length
    const tw = wr.reduce((s,r)=>s+r.hours,0)
    const ot = Math.max(0,tw-normHours), reg = tw-ot
    const wSal = dr*reg + dr*globalOT*ot
    const pd = dr*hoursPerDay
    const vp = Math.round(pd*vd*vacCoeff*100)/100, sp = Math.round(pd*sd*sickCoeff*100)/100
    const total = Math.round((wSal+vp+sp)*100)/100
    twDays+=wr.length; twHours+=tw; tOT+=ot; tvDays+=vd; tsDays+=sd; tSal+=wSal; tvPay+=vp; tsPay+=sp; tTotal+=total
    const row = ws.addRow([idx+1, emp.full_name, emp.position, wr.length, Math.round(tw*100)/100, Math.round(ot*100)/100, vd, sd, Math.round(wSal*100)/100, vp, sp, total])
    row.alignment={horizontal:'center',vertical:'middle'}; row.getCell(2).alignment={horizontal:'left',vertical:'middle'}; row.getCell(3).alignment={horizontal:'left',vertical:'middle'}
    for(let c=9;c<=12;c++) row.getCell(c).numFmt='#,##0.00'
  })
  ws.addRow([])
  const tr = ws.addRow(['', i.total.replace(':',''), '', twDays, Math.round(twHours*100)/100, Math.round(tOT*100)/100, tvDays, tsDays, Math.round(tSal*100)/100, Math.round(tvPay*100)/100, Math.round(tsPay*100)/100, Math.round(tTotal*100)/100])
  tr.font={bold:true}; tr.alignment={horizontal:'center',vertical:'middle'}; tr.getCell(2).alignment={horizontal:'left'}
  for(let c=9;c<=12;c++) tr.getCell(c).numFmt='#,##0.00'

  const buf = await wb.xlsx.writeBuffer()
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(i.title)}_${year}_${String(m).padStart(2,'0')}.xlsx"`)
  res.send(buf)
})

app.get('/companies/:id/export/salary-pdf/:year/:month', (req, res) => {
  const db = req.db
  const { year, month } = req.params
  const lang = req.query.lang || 'uk'
  const y = Number(year), m = Number(month)
  const prefix = `${year}-${String(m).padStart(2,'0')}`
  const monthStart = `${prefix}-01`

  const MONTHS = { ru:['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'], uk:['Січень','Лютий','Березень','Квітень','Травень','Червень','Липень','Серпень','Вересень','Жовтень','Листопад','Грудень'], en:['January','February','March','April','May','June','July','August','September','October','November','December'] }
  const months = MONTHS[lang] || MONTHS.uk
  const I = {
    ru: { title:'Ведомость заработной платы', colName:'ФИО', colPos:'Должность', colWDays:'Отраб.\nдн.', colWHours:'Отраб.\nч.', colOT:'Перераб.\nч.', colVDays:'Отпуск\nдн.', colSDays:'Больн.\nдн.', colSal:'Зарплата', colVPay:'Отпускные', colSPay:'Больничные', colTotal:'Итого', total:'ИТОГО:' },
    uk: { title:'Відомість заробітної плати', colName:'ПІБ', colPos:'Посада', colWDays:'Відпрац.\nдн.', colWHours:'Відпрац.\nгод.', colOT:'Переробіт.\nгод.', colVDays:'Відпустка\nдн.', colSDays:'Ліка-рняні\nдн.', colSal:'Зарплата', colVPay:'Відпускні', colSPay:'Лікарняні', colTotal:'Всього', total:'РАЗОМ:' },
    en: { title:'Payroll', colName:'Full name', colPos:'Position', colWDays:'Worked\ndays', colWHours:'Worked\nhrs.', colOT:'Overtime\nhrs.', colVDays:'Vacation\ndays', colSDays:'Sick\ndays', colSal:'Salary', colVPay:'Vac. pay', colSPay:'Sick pay', colTotal:'Total', total:'TOTAL:' },
  }
  const i = I[lang] || I.uk

  const holidayDates = db.prepare('SELECT date FROM holidays WHERE date LIKE ?').all(prefix+'%').map(r=>r.date)
  const workdayDates = db.prepare('SELECT date FROM workdays WHERE date LIKE ?').all(prefix+'%').map(r=>r.date)
  const daysInMonth = new Date(y, m, 0).getDate()
  const holidaySet = new Set(holidayDates), workdaySet = new Set(workdayDates)
  let normDays = 0
  for (let d=1; d<=daysInMonth; d++) {
    const dow = new Date(y,m-1,d).getDay(), ds=`${prefix}-${String(d).padStart(2,'0')}`
    if (workdaySet.has(ds)) normDays++
    else if (dow!==0&&dow!==6&&!holidaySet.has(ds)) normDays++
  }
  const hoursPerDay = Number((db.prepare("SELECT value FROM settings WHERE key='workHoursPerDay'").get()||{value:'8'}).value)
  const normHours = normDays*hoursPerDay
  const otCoeffRow = db.prepare('SELECT value FROM month_settings WHERE year=? AND month=? AND key=?').get(y,m,'overtimeCoeff')
  const globalOT = otCoeffRow ? Number(otCoeffRow.value) : Number((db.prepare("SELECT value FROM settings WHERE key='overtimeCoeff'").get()||{value:'1.5'}).value)
  const vacCoeffRow = db.prepare('SELECT value FROM month_settings WHERE year=? AND month=? AND key=?').get(y,m,'vacationCoeff')
  const vacCoeff = vacCoeffRow ? Number(vacCoeffRow.value) : 1
  const sickCoeffRow = db.prepare('SELECT value FROM month_settings WHERE year=? AND month=? AND key=?').get(y,m,'sickCoeff')
  const sickCoeff = sickCoeffRow ? Number(sickCoeffRow.value) : 0

  const employees = db.prepare('SELECT * FROM employees WHERE is_active=1 ORDER BY full_name').all()
  const records = db.prepare('SELECT * FROM timesheet_records WHERE date LIKE ?').all(prefix+'%')
  const company = db.prepare('SELECT * FROM companies WHERE id=?').get(req.params.id) || {name:''}

  let twDays=0,twHours=0,tOT=0,tvDays=0,tsDays=0,tSal=0,tvPay=0,tsPay=0,tTotal=0
  const rowsHtml = employees.map((emp,idx) => {
    const hist = db.prepare('SELECT rate_type,rate FROM salary_history WHERE employee_id=? AND effective_from<=? ORDER BY effective_from DESC LIMIT 1').get(emp.id,monthStart)
    const rateType = hist?.rate_type||emp.rate_type, rate = hist?.rate||emp.rate
    const dr = rateType==='hourly'?rate:normHours>0?rate/normHours:0
    const er = records.filter(r=>r.employee_id===emp.id)
    const wr = er.filter(r=>r.code==='Я'), vd=er.filter(r=>r.code==='О').length, sd=er.filter(r=>r.code==='Б').length
    const tw = wr.reduce((s,r)=>s+r.hours,0), ot=Math.max(0,tw-normHours), reg=tw-ot
    const wSal=dr*reg+dr*globalOT*ot, pd=dr*hoursPerDay
    const vp=Math.round(pd*vd*vacCoeff*100)/100, sp=Math.round(pd*sd*sickCoeff*100)/100
    const total=Math.round((wSal+vp+sp)*100)/100
    twDays+=wr.length;twHours+=tw;tOT+=ot;tvDays+=vd;tsDays+=sd;tSal+=wSal;tvPay+=vp;tsPay+=sp;tTotal+=total
    const f2=n=>n.toLocaleString('uk-UA',{minimumFractionDigits:2,maximumFractionDigits:2})
    return `<tr><td>${idx+1}</td><td class="left">${emp.full_name}</td><td class="left">${emp.position||''}</td><td>${wr.length}</td><td>${f2(tw)}</td><td>${f2(ot)}</td><td>${vd}</td><td>${sd}</td><td class="num">${f2(Math.round(wSal*100)/100)}</td><td class="num">${f2(vp)}</td><td class="num">${f2(sp)}</td><td class="num bold">${f2(total)}</td></tr>`
  }).join('')
  const f2=n=>n.toLocaleString('uk-UA',{minimumFractionDigits:2,maximumFractionDigits:2})

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:Arial,sans-serif;font-size:11px;margin:16px}h2{font-size:13px;margin:0 0 4px}.sub{font-size:11px;color:#555;margin-bottom:10px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #999;padding:3px 5px;text-align:center}th{background:#f0f0f0;font-size:10px;white-space:pre-line}.left{text-align:left}.num{text-align:right}.bold{font-weight:bold}.totals td{background:#f5f5f5;font-weight:bold}@media print{@page{size:A4 landscape;margin:10mm}}</style></head><body>
<h2>${i.title}</h2><div class="sub">${company.name} — ${months[m-1]} ${year}</div>
<table><thead><tr><th>№</th><th>${i.colName}</th><th>${i.colPos}</th><th>${i.colWDays}</th><th>${i.colWHours}</th><th>${i.colOT}</th><th>${i.colVDays}</th><th>${i.colSDays}</th><th>${i.colSal}</th><th>${i.colVPay}</th><th>${i.colSPay}</th><th>${i.colTotal}</th></tr></thead>
<tbody>${rowsHtml}</tbody>
<tfoot><tr class="totals"><td></td><td class="left">${i.total.replace(':','')}</td><td></td><td>${twDays}</td><td>${f2(twHours)}</td><td>${f2(tOT)}</td><td>${tvDays}</td><td>${tsDays}</td><td class="num">${f2(tSal)}</td><td class="num">${f2(tvPay)}</td><td class="num">${f2(tsPay)}</td><td class="num bold">${f2(tTotal)}</td></tr></tfoot>
</table><script>window.print()</script></body></html>`

  res.setHeader('Content-Type','text/html; charset=utf-8')
  res.send(html)
})

// ─── Backup / Audit endpoints ─────────────────────────────────────────────────
app.get('/companies/:id/export/json', (req, res) => {
  const db = req.db
  const data = {
    version: '1.4.0', exportedAt: new Date().toISOString(),
    departments: db.prepare('SELECT * FROM departments').all(),
    employees: db.prepare('SELECT * FROM employees').all(),
    salaryHistory: db.prepare('SELECT * FROM salary_history').all(),
    timesheetRecords: db.prepare('SELECT * FROM timesheet_records').all(),
    holidays: db.prepare('SELECT date FROM holidays').all().map(r=>r.date),
    workdays: db.prepare('SELECT date FROM workdays').all().map(r=>r.date),
    monthSettings: db.prepare('SELECT * FROM month_settings').all(),
    settings: db.prepare('SELECT * FROM settings').all(),
  }
  res.setHeader('Content-Disposition', `attachment; filename="tvtab-backup-${req.params.id}.json"`)
  res.json(data)
})

app.post('/companies/:id/import/json', (req, res) => {
  const db = req.db
  const data = req.body
  db.transaction(() => {
    db.exec('DELETE FROM timesheet_records; DELETE FROM salary_history; DELETE FROM employees; DELETE FROM departments; DELETE FROM holidays; DELETE FROM workdays; DELETE FROM month_settings')
    try { db.exec('DELETE FROM sqlite_sequence') } catch {}
    for (const d of data.departments ?? []) db.prepare('INSERT INTO departments (id,name) VALUES (?,?)').run(d.id, d.name)
    for (const e of data.employees ?? []) db.prepare('INSERT INTO employees (id,full_name,position,department_id,rate_type,rate,hired_date,is_active) VALUES (?,?,?,?,?,?,?,?)').run(e.id, e.full_name, e.position, e.department_id, e.rate_type, e.rate, e.hired_date, e.is_active)
    for (const s of data.salaryHistory ?? []) db.prepare('INSERT INTO salary_history (id,employee_id,effective_from,rate_type,rate,note) VALUES (?,?,?,?,?,?)').run(s.id, s.employee_id, s.effective_from, s.rate_type, s.rate, s.note??'')
    for (const r of data.timesheetRecords ?? []) db.prepare('INSERT INTO timesheet_records (id,employee_id,date,code,hours,arrival_time,departure_time,overtime_coeff) VALUES (?,?,?,?,?,?,?,?)').run(r.id, r.employee_id, r.date, r.code, r.hours, r.arrival_time, r.departure_time, r.overtime_coeff)
    for (const date of data.holidays ?? []) db.prepare('INSERT OR IGNORE INTO holidays (date) VALUES (?)').run(date)
    for (const date of data.workdays ?? []) db.prepare('INSERT OR IGNORE INTO workdays (date) VALUES (?)').run(date)
    for (const ms of data.monthSettings ?? []) db.prepare('INSERT OR REPLACE INTO month_settings (year,month,key,value) VALUES (?,?,?,?)').run(ms.year, ms.month, ms.key, ms.value)
    for (const s of data.settings ?? []) db.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)').run(s.key, s.value)
  })()
  broadcast(req.companyId)
  res.json({ ok: true })
})

app.get('/companies/:id/audit/download', (req, res) => {
  const logPath = path.join(DATA_DIR, 'companies', `${req.params.id}.audit.jsonl`)
  if (!fs.existsSync(logPath)) return res.status(404).json({ error: 'No audit log found' })
  res.download(logPath, `tvtab-audit-${req.params.id}.jsonl`)
})

app.post('/companies/:id/restore-from-audit', (req, res) => {
  const db = req.db
  const logPath = path.join(DATA_DIR, 'companies', `${req.params.id}.audit.jsonl`)
  if (!fs.existsSync(logPath)) return res.status(404).json({ error: 'No audit log found' })
  const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean)
  const entries = lines.map(l => JSON.parse(l))
  let restored = 0, errors = 0
  db.transaction(() => {
    db.exec('DELETE FROM timesheet_records; DELETE FROM salary_history; DELETE FROM employees; DELETE FROM departments; DELETE FROM holidays; DELETE FROM workdays; DELETE FROM month_settings')
    try { db.exec('DELETE FROM sqlite_sequence') } catch {}
    for (const entry of entries) {
      try { applyAuditEntry(db, entry); restored++ } catch { errors++ }
    }
  })()
  broadcast(req.companyId)
  res.json({ ok: true, restored, errors })
})

// ─── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`TVTab server running on http://localhost:${PORT}`)
  console.log(`Data directory: ${path.resolve(DATA_DIR)}`)
})

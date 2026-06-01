'use strict'

const { app, Tray, Menu, nativeImage, clipboard, shell, dialog, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')
const zlib = require('zlib')
const http = require('http')

// ─── Single instance ────────────────────────────────────────────────────────
if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0) }

// ─── Paths ───────────────────────────────────────────────────────────────────
const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json')
const DEFAULT_DATA_DIR = path.join(app.getPath('userData'), 'data')

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) } catch { return {} }
}
function saveConfig(cfg) {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true })
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2))
}

let config = loadConfig()
let PORT = config.port || 3001
let DATA_DIR = config.dataDir || DEFAULT_DATA_DIR
fs.mkdirSync(path.join(DATA_DIR, 'companies'), { recursive: true })

// ─── PNG icon generator (built-in, no external deps) ─────────────────────────
function createColorIcon(r, g, b, size = 32) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

  // CRC32
  const crcTable = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
    crcTable[i] = c
  }
  function crc32(buf) {
    let crc = 0xFFFFFFFF
    for (const b of buf) crc = crcTable[(crc ^ b) & 0xFF] ^ (crc >>> 8)
    return ((crc ^ 0xFFFFFFFF) >>> 0)
  }

  function chunk(type, data) {
    const t = Buffer.from(type, 'ascii')
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const crcBuf = Buffer.alloc(4); crcBuf.writeUInt32BE(crc32(Buffer.concat([t, data])))
    return Buffer.concat([len, t, data, crcBuf])
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8; ihdr[9] = 2 // 8-bit RGB

  const raw = Buffer.alloc(size * (1 + size * 3))
  for (let y = 0; y < size; y++) {
    const base = y * (1 + size * 3)
    raw[base] = 0 // filter: None
    for (let x = 0; x < size; x++) {
      // Draw a circle with flat design
      const cx = size / 2, cy = size / 2, radius = size / 2 - 2
      const dx = x - cx + 0.5, dy = y - cy + 0.5
      const inside = Math.sqrt(dx*dx + dy*dy) <= radius
      raw[base + 1 + x*3]     = inside ? r : 240
      raw[base + 1 + x*3 + 1] = inside ? g : 240
      raw[base + 1 + x*3 + 2] = inside ? b : 240
    }
  }

  const idat = zlib.deflateSync(raw)
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))])
}

// ─── sql.js helpers ───────────────────────────────────────────────────────────
let SQL = null

async function initSql() {
  const initSqlJs = require('sql.js')
  const wasmPath = app.isPackaged
    ? path.join(process.resourcesPath, 'sql-wasm.wasm')
    : path.join(__dirname, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm')
  SQL = await initSqlJs({ locateFile: () => wasmPath })
}

function openDb(dbPath) {
  const data = fs.existsSync(dbPath) ? fs.readFileSync(dbPath) : null
  return new SQL.Database(data)
}

function persist(db, dbPath) {
  fs.writeFileSync(dbPath, Buffer.from(db.export()))
}

function dbGet(db, sql, params = []) {
  const stmt = db.prepare(sql)
  stmt.bind(params)
  if (stmt.step()) { const r = stmt.getAsObject(); stmt.free(); return r }
  stmt.free(); return undefined
}

function dbAll(db, sql, params = []) {
  const rows = [], stmt = db.prepare(sql)
  stmt.bind(params)
  while (stmt.step()) rows.push(stmt.getAsObject())
  stmt.free()
  return rows
}

function dbRun(db, sql, params = []) {
  db.run(sql, params)
}

// ─── Master DB (companies list) ───────────────────────────────────────────────
let masterDb = null
const masterDbPath = path.join(DATA_DIR, 'master.db')

function initMasterDb() {
  masterDb = openDb(masterDbPath)
  masterDb.run(`
    CREATE TABLE IF NOT EXISTS companies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      currency TEXT NOT NULL DEFAULT '₴',
      created_at TEXT NOT NULL,
      last_opened_at TEXT NOT NULL
    )
  `)
  persist(masterDb, masterDbPath)
}

const COMPANY_SCHEMA = `
  CREATE TABLE IF NOT EXISTS departments (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS employees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name TEXT NOT NULL, position TEXT, department_id INTEGER,
    rate_type TEXT NOT NULL, rate REAL NOT NULL DEFAULT 0,
    hired_date TEXT, is_active INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS timesheet_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL, date TEXT NOT NULL,
    code TEXT NOT NULL DEFAULT 'Я', hours REAL NOT NULL DEFAULT 8,
    arrival_time TEXT, departure_time TEXT, overtime_coeff REAL,
    UNIQUE(employee_id, date)
  );
  CREATE TABLE IF NOT EXISTS salary_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL, effective_from TEXT NOT NULL,
    rate_type TEXT NOT NULL, rate REAL NOT NULL, note TEXT NOT NULL DEFAULT '',
    UNIQUE(employee_id, effective_from)
  );
  CREATE TABLE IF NOT EXISTS holidays (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL UNIQUE);
  CREATE TABLE IF NOT EXISTS workdays (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL UNIQUE);
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS month_settings (
    year INTEGER NOT NULL, month INTEGER NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL,
    PRIMARY KEY (year, month, key)
  );
`

const companyDbs = {}
function getCompanyDb(id) {
  if (companyDbs[id]) return companyDbs[id]
  const dbPath = path.join(DATA_DIR, 'companies', `${id}.db`)
  const db = openDb(dbPath)
  db.run(COMPANY_SCHEMA)
  persist(db, dbPath)
  companyDbs[id] = { db, path: dbPath }
  return companyDbs[id]
}

// ─── SSE broadcast ────────────────────────────────────────────────────────────
const sseClients = new Map() // companyId → Set<res>

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

function persistCompany(id) {
  if (!companyDbs[id]) return
  persist(companyDbs[id].db, companyDbs[id].path)
  broadcast(id)
}

// ─── Salary helpers ───────────────────────────────────────────────────────────
function getWorkingDaysInMonth(year, month, holidayDates, workdayDates) {
  const daysInMonth = new Date(year, month, 0).getDate()
  const prefix = `${year}-${String(month).padStart(2,'0')}`
  const hSet = new Set(holidayDates), wSet = new Set(workdayDates)
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

function calcSalaryForEmployee(db, empId, year, month, normDays, normHours, hoursPerDay, overtimeCoeff) {
  const prefix = `${year}-${String(month).padStart(2,'0')}`
  const monthStart = `${prefix}-01`
  const emp = dbGet(db, 'SELECT * FROM employees WHERE id=?', [empId])
  if (!emp) return null

  const histEntry = dbGet(db,
    'SELECT rate_type, rate FROM salary_history WHERE employee_id=? AND effective_from<=? ORDER BY effective_from DESC LIMIT 1',
    [empId, monthStart])
  const rateType = histEntry?.rate_type ?? emp.rate_type
  const rate = histEntry?.rate ?? emp.rate

  const rows = dbAll(db, 'SELECT * FROM timesheet_records WHERE employee_id=? AND date LIKE ? ORDER BY date', [empId, prefix+'%'])
  const workedRecs = rows.filter(r => r.code === 'Я')
  const vacationDays = rows.filter(r => r.code === 'О').length
  const sickDays = rows.filter(r => r.code === 'Б').length

  const vacRow = dbGet(db, 'SELECT value FROM month_settings WHERE year=? AND month=? AND key=?', [year, month, 'vacationCoeff'])
  const sickRow = dbGet(db, 'SELECT value FROM month_settings WHERE year=? AND month=? AND key=?', [year, month, 'sickCoeff'])
  const vacationCoeff = vacRow ? Number(vacRow.value) : 1
  const sickCoeff = sickRow ? Number(sickRow.value) : 0

  const derivedHourlyRate = rateType === 'hourly' ? rate : normHours > 0 ? rate / normHours : 0
  const { regularHours, overtimeHours, salary: workedSalary } = calcEmployeeSalary(workedRecs, derivedHourlyRate, normHours, overtimeCoeff)

  const perDayRate = derivedHourlyRate * hoursPerDay
  const vacationPay = Math.round(perDayRate * vacationDays * vacationCoeff * 100) / 100
  const sickPay = Math.round(perDayRate * sickDays * sickCoeff * 100) / 100
  const salary = Math.round((workedSalary + vacationPay + sickPay) * 100) / 100
  const regularSalary = Math.round(derivedHourlyRate * regularHours * 100) / 100
  const overtimeSalary = Math.round((workedSalary - regularSalary) * 100) / 100

  return {
    emp, rateType, rate, derivedHourlyRate: Math.round(derivedHourlyRate * 100) / 100,
    vacationCoeff, sickCoeff,
    rows, workedRecs, workedDays: workedRecs.length,
    regularHours, overtimeHours,
    workedHours: Math.round((regularHours + overtimeHours) * 100) / 100,
    vacationDays, sickDays, regularSalary, overtimeSalary, vacationPay, sickPay, salary,
  }
}

// ─── Express server ───────────────────────────────────────────────────────────
let expressApp = null
let server = null

function buildExpressApp() {
  const express = require('express')
  const cors = require('cors')
  const ExcelJS = require('exceljs')

  const app = express()
  app.use(cors())
  app.use(express.json())

  // ── Companies ─────────────────────────────────────────────────────────────
  app.get('/companies', (req, res) => {
    res.json(dbAll(masterDb, 'SELECT * FROM companies ORDER BY last_opened_at DESC').map(c => ({
      id: c.id, name: c.name, currency: c.currency, createdAt: c.created_at, lastOpenedAt: c.last_opened_at
    })))
  })
  app.post('/companies', (req, res) => {
    const { name, currency = '₴' } = req.body
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
    const now = new Date().toISOString()
    dbRun(masterDb, 'INSERT INTO companies (id,name,currency,created_at,last_opened_at) VALUES (?,?,?,?,?)', [id, name, currency, now, now])
    persist(masterDb, masterDbPath)
    getCompanyDb(id)
    res.json({ id, name, currency, createdAt: now, lastOpenedAt: now })
  })
  app.put('/companies/:id', (req, res) => {
    const { name, currency } = req.body
    dbRun(masterDb, 'UPDATE companies SET name=?, currency=? WHERE id=?', [name, currency, req.params.id])
    persist(masterDb, masterDbPath)
    res.json({ ok: true })
  })
  app.delete('/companies/:id', (req, res) => {
    const id = req.params.id
    dbRun(masterDb, 'DELETE FROM companies WHERE id=?', [id])
    persist(masterDb, masterDbPath)
    if (companyDbs[id]) { companyDbs[id].db.close(); delete companyDbs[id] }
    const dbPath = path.join(DATA_DIR, 'companies', `${id}.db`)
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath)
    res.json({ ok: true })
  })
  app.post('/companies/:id/open', (req, res) => {
    const now = new Date().toISOString()
    dbRun(masterDb, 'UPDATE companies SET last_opened_at=? WHERE id=?', [now, req.params.id])
    persist(masterDb, masterDbPath)
    res.json({ ok: true })
  })

  // ── Company middleware ─────────────────────────────────────────────────────
  app.use('/companies/:id', (req, res, next) => {
    const c = dbGet(masterDb, 'SELECT id FROM companies WHERE id=?', [req.params.id])
    if (!c) return res.status(404).json({ error: 'Company not found' })
    const { db } = getCompanyDb(req.params.id)
    req.db = db
    req.companyId = req.params.id
    next()
  })

  // ── SSE events ────────────────────────────────────────────────────────────
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

  // ── Departments ───────────────────────────────────────────────────────────
  app.get('/companies/:id/departments', (req, res) => {
    res.json(dbAll(req.db, 'SELECT * FROM departments ORDER BY name'))
  })
  app.post('/companies/:id/departments', (req, res) => {
    dbRun(req.db, 'INSERT INTO departments (name) VALUES (?)', [req.body.name])
    persistCompany(req.companyId)
    const row = dbGet(req.db, 'SELECT last_insert_rowid() AS id')
    res.json({ id: row.id, name: req.body.name })
  })
  app.delete('/companies/:id/departments/:did', (req, res) => {
    dbRun(req.db, 'DELETE FROM departments WHERE id=?', [req.params.did])
    persistCompany(req.companyId)
    res.json({ ok: true })
  })

  // ── Employees ─────────────────────────────────────────────────────────────
  app.get('/companies/:id/employees', (req, res) => {
    res.json(dbAll(req.db, `SELECT e.*, d.name AS department_name FROM employees e LEFT JOIN departments d ON d.id=e.department_id ORDER BY e.full_name`))
  })
  app.post('/companies/:id/employees', (req, res) => {
    const b = req.body
    dbRun(req.db, 'INSERT INTO employees (full_name,position,department_id,rate_type,rate,hired_date,is_active) VALUES (?,?,?,?,?,?,1)',
      [b.fullName, b.position||'', b.departmentId||null, b.rateType, b.rate, b.hiredDate||null])
    persistCompany(req.companyId)
    const row = dbGet(req.db, 'SELECT last_insert_rowid() AS id')
    res.json({ id: row.id, ...b, isActive: true })
  })
  app.put('/companies/:id/employees/:eid', (req, res) => {
    const b = req.body
    dbRun(req.db, 'UPDATE employees SET full_name=?,position=?,department_id=?,rate_type=?,rate=?,hired_date=?,is_active=? WHERE id=?',
      [b.fullName, b.position||'', b.departmentId||null, b.rateType, b.rate, b.hiredDate||null, b.isActive?1:0, req.params.eid])
    persistCompany(req.companyId)
    res.json({ ok: true })
  })
  app.delete('/companies/:id/employees/:eid', (req, res) => {
    dbRun(req.db, 'DELETE FROM employees WHERE id=?', [req.params.eid])
    persistCompany(req.companyId)
    res.json({ ok: true })
  })

  // ── Timesheet ─────────────────────────────────────────────────────────────
  app.get('/companies/:id/timesheet/:year/:month', (req, res) => {
    const prefix = `${req.params.year}-${String(req.params.month).padStart(2,'0')}`
    res.json(dbAll(req.db, 'SELECT * FROM timesheet_records WHERE date LIKE ?', [prefix+'%']))
  })
  app.post('/companies/:id/timesheet/record', (req, res) => {
    const b = req.body
    dbRun(req.db, `INSERT INTO timesheet_records (employee_id,date,code,hours,arrival_time,departure_time,overtime_coeff) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(employee_id,date) DO UPDATE SET code=excluded.code,hours=excluded.hours,arrival_time=excluded.arrival_time,departure_time=excluded.departure_time,overtime_coeff=excluded.overtime_coeff`,
      [b.employeeId, b.date, b.code, b.hours, b.arrivalTime||null, b.departureTime||null, b.overtimeCoeff||null])
    persistCompany(req.companyId)
    res.json({ ok: true })
  })
  app.delete('/companies/:id/timesheet/record/:empId/:date', (req, res) => {
    dbRun(req.db, 'DELETE FROM timesheet_records WHERE employee_id=? AND date=?', [req.params.empId, req.params.date])
    persistCompany(req.companyId)
    res.json({ ok: true })
  })
  app.post('/companies/:id/timesheet/bulk', (req, res) => {
    for (const r of req.body) {
      dbRun(req.db, `INSERT INTO timesheet_records (employee_id,date,code,hours,arrival_time,departure_time,overtime_coeff) VALUES (?,?,?,?,?,?,?)
        ON CONFLICT(employee_id,date) DO UPDATE SET code=excluded.code,hours=excluded.hours,arrival_time=excluded.arrival_time,departure_time=excluded.departure_time,overtime_coeff=excluded.overtime_coeff`,
        [r.employeeId, r.date, r.code, r.hours, r.arrivalTime||null, r.departureTime||null, r.overtimeCoeff||null])
    }
    persistCompany(req.companyId)
    res.json({ ok: true })
  })

  // ── Salary history ────────────────────────────────────────────────────────
  app.get('/companies/:id/salary-history/:empId', (req, res) => {
    res.json(dbAll(req.db, 'SELECT * FROM salary_history WHERE employee_id=? ORDER BY effective_from DESC', [req.params.empId]))
  })
  app.post('/companies/:id/salary-history', (req, res) => {
    const b = req.body
    dbRun(req.db, 'INSERT INTO salary_history (employee_id,effective_from,rate_type,rate,note) VALUES (?,?,?,?,?)',
      [b.employeeId, b.effectiveFrom, b.rateType, b.rate, b.note||''])
    persistCompany(req.companyId)
    const row = dbGet(req.db, 'SELECT last_insert_rowid() AS id')
    res.json({ id: row.id, ...b })
  })
  app.delete('/companies/:id/salary-history/:histId', (req, res) => {
    const empId = req.query.employeeId
    const cnt = dbGet(req.db, 'SELECT COUNT(*) AS cnt FROM salary_history WHERE employee_id=?', [empId])
    if (cnt.cnt <= 1) return res.status(400).json({ error: 'Cannot delete last rate record' })
    dbRun(req.db, 'DELETE FROM salary_history WHERE id=?', [req.params.histId])
    persistCompany(req.companyId)
    res.json({ ok: true })
  })

  // ── Holidays / Workdays ───────────────────────────────────────────────────
  app.get('/companies/:id/holidays/:year/:month', (req, res) => {
    const prefix = `${req.params.year}-${String(req.params.month).padStart(2,'0')}`
    res.json(dbAll(req.db, 'SELECT date FROM holidays WHERE date LIKE ?', [prefix+'%']).map(r=>r.date))
  })
  app.post('/companies/:id/holidays/toggle', (req, res) => {
    const { date } = req.body
    const ex = dbGet(req.db, 'SELECT id FROM holidays WHERE date=?', [date])
    if (ex) { dbRun(req.db, 'DELETE FROM holidays WHERE date=?', [date]); persistCompany(req.companyId); res.json({ active: false }) }
    else { dbRun(req.db, 'INSERT INTO holidays (date) VALUES (?)', [date]); persistCompany(req.companyId); res.json({ active: true }) }
  })
  app.get('/companies/:id/workdays/:year/:month', (req, res) => {
    const prefix = `${req.params.year}-${String(req.params.month).padStart(2,'0')}`
    res.json(dbAll(req.db, 'SELECT date FROM workdays WHERE date LIKE ?', [prefix+'%']).map(r=>r.date))
  })
  app.post('/companies/:id/workdays/toggle', (req, res) => {
    const { date } = req.body
    const ex = dbGet(req.db, 'SELECT id FROM workdays WHERE date=?', [date])
    if (ex) { dbRun(req.db, 'DELETE FROM workdays WHERE date=?', [date]); persistCompany(req.companyId); res.json({ active: false }) }
    else { dbRun(req.db, 'INSERT INTO workdays (date) VALUES (?)', [date]); persistCompany(req.companyId); res.json({ active: true }) }
  })

  // ── Month settings ────────────────────────────────────────────────────────
  app.get('/companies/:id/month-settings/:year/:month/:key', (req, res) => {
    const { year, month, key } = req.params
    const row = dbGet(req.db, 'SELECT value FROM month_settings WHERE year=? AND month=? AND key=?', [Number(year), Number(month), key])
    res.json(row ? Number(row.value) : null)
  })
  app.put('/companies/:id/month-settings/:year/:month/:key', (req, res) => {
    const { year, month, key } = req.params
    dbRun(req.db, 'INSERT OR REPLACE INTO month_settings (year,month,key,value) VALUES (?,?,?,?)',
      [Number(year), Number(month), key, String(req.body.value)])
    persistCompany(req.companyId)
    res.json({ ok: true })
  })

  // ── Salary summary ────────────────────────────────────────────────────────
  app.get('/companies/:id/salary/:year/:month', (req, res) => {
    const db = req.db, { year, month } = req.params
    const y = Number(year), m = Number(month)
    const prefix = `${year}-${String(m).padStart(2,'0')}`

    const holidays = dbAll(db,'SELECT date FROM holidays WHERE date LIKE ?',[prefix+'%']).map(r=>r.date)
    const workdays = dbAll(db,'SELECT date FROM workdays WHERE date LIKE ?',[prefix+'%']).map(r=>r.date)
    const normDays = getWorkingDaysInMonth(y, m, holidays, workdays)
    const hpd = dbGet(db,'SELECT value FROM settings WHERE key=?',['workHoursPerDay'])
    const hoursPerDay = Number(hpd?.value ?? 8)
    const normHours = normDays * hoursPerDay
    const otRow = dbGet(db,'SELECT value FROM month_settings WHERE year=? AND month=? AND key=?',[y,m,'overtimeCoeff'])
      ?? dbGet(db,'SELECT value FROM settings WHERE key=?',['overtimeCoeff'])
    const overtimeCoeff = Number(otRow?.value ?? 1.5)

    const employees = dbAll(db, `SELECT e.*, d.name AS department_name FROM employees e LEFT JOIN departments d ON d.id=e.department_id WHERE e.is_active=1 ORDER BY e.full_name`)

    res.json(employees.map(emp => {
      const s = calcSalaryForEmployee(db, emp.id, y, m, normDays, normHours, hoursPerDay, overtimeCoeff)
      if (!s) return null
      return {
        employee: { id: emp.id, fullName: emp.full_name, position: emp.position, departmentId: emp.department_id, departmentName: emp.department_name, rateType: emp.rate_type, rate: emp.rate, hiredDate: emp.hired_date, isActive: true },
        normDays, effectiveRate: s.rate, effectiveRateType: s.rateType, derivedHourlyRate: s.derivedHourlyRate,
        workedDays: s.workedDays, workedHours: s.workedHours, overtimeHours: s.overtimeHours,
        vacationDays: s.vacationDays, sickDays: s.sickDays, vacationPay: s.vacationPay, sickPay: s.sickPay, salary: s.salary,
      }
    }).filter(Boolean))
  })

  // ── Salary detail ─────────────────────────────────────────────────────────
  app.get('/companies/:id/salary/:year/:month/detail/:empId', (req, res) => {
    const db = req.db, { year, month, empId } = req.params
    const y = Number(year), m = Number(month)
    const prefix = `${year}-${String(m).padStart(2,'0')}`

    const holidays = dbAll(db,'SELECT date FROM holidays WHERE date LIKE ?',[prefix+'%']).map(r=>r.date)
    const workdays = dbAll(db,'SELECT date FROM workdays WHERE date LIKE ?',[prefix+'%']).map(r=>r.date)
    const normDays = getWorkingDaysInMonth(y, m, holidays, workdays)
    const hpd = dbGet(db,'SELECT value FROM settings WHERE key=?',['workHoursPerDay'])
    const hoursPerDay = Number(hpd?.value ?? 8)
    const normHours = normDays * hoursPerDay
    const otRow = dbGet(db,'SELECT value FROM month_settings WHERE year=? AND month=? AND key=?',[y,m,'overtimeCoeff'])
      ?? dbGet(db,'SELECT value FROM settings WHERE key=?',['overtimeCoeff'])
    const overtimeCoeff = Number(otRow?.value ?? 1.5)

    const s = calcSalaryForEmployee(db, Number(empId), y, m, normDays, normHours, hoursPerDay, overtimeCoeff)
    if (!s) return res.json(null)

    res.json({
      employee: { id: s.emp.id, fullName: s.emp.full_name, position: s.emp.position },
      year: y, month: m, normDays, normHours, hoursPerDay,
      globalOvertimeCoeff: overtimeCoeff, vacationCoeff: s.vacationCoeff, sickCoeff: s.sickCoeff,
      effectiveRate: s.rate, effectiveRateType: s.rateType, derivedHourlyRate: s.derivedHourlyRate,
      records: s.rows.map(r => ({ date: r.date, code: r.code, arrivalTime: r.arrival_time||undefined, departureTime: r.departure_time||undefined, hours: r.hours, regularHours: r.hours, overtimeHours: 0, overtimeCoeff })),
      workedDays: s.workedDays, regularHours: s.regularHours, overtimeHours: s.overtimeHours, workedHours: s.workedHours,
      vacationDays: s.vacationDays, sickDays: s.sickDays,
      regularSalary: s.regularSalary, overtimeSalary: s.overtimeSalary,
      vacationPay: s.vacationPay, sickPay: s.sickPay, salary: s.salary,
    })
  })

  // ── Excel export ──────────────────────────────────────────────────────────
  app.get('/companies/:id/export/excel/:year/:month', async (req, res) => {
    const db = req.db, { year, month } = req.params
    const lang = req.query.lang || 'uk'
    const y = Number(year), m = Number(month)
    const prefix = `${year}-${String(m).padStart(2,'0')}`
    const daysInMonth = new Date(y, m, 0).getDate()
    const MONTHS = { ru:['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'], uk:['Січень','Лютий','Березень','Квітень','Травень','Червень','Липень','Серпень','Вересень','Жовтень','Листопад','Грудень'], en:['January','February','March','April','May','June','July','August','September','October','November','December'] }
    const months = MONTHS[lang]||MONTHS.uk
    const employees = dbAll(db,'SELECT * FROM employees WHERE is_active=1 ORDER BY full_name')
    const records = dbAll(db,'SELECT * FROM timesheet_records WHERE date LIKE ?',[prefix+'%'])
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet(`${months[m-1]} ${year}`)
    const hr = ws.addRow(['№','ПІБ','Посада',...Array.from({length:daysInMonth},(_,i)=>i+1),'Дн.','Год.'])
    hr.font={bold:true}; hr.alignment={horizontal:'center',vertical:'middle',wrapText:true}
    ws.getColumn(1).width=5; ws.getColumn(2).width=28; ws.getColumn(3).width=18
    for (let ci=4;ci<=3+daysInMonth;ci++) ws.getColumn(ci).width=5
    ws.getColumn(4+daysInMonth).width=7; ws.getColumn(5+daysInMonth).width=7
    employees.forEach((emp,idx) => {
      const er = records.filter(r=>r.employee_id===emp.id)
      const days=[]; let wd=0,wh=0
      for(let d=1;d<=daysInMonth;d++){
        const ds=`${prefix}-${String(d).padStart(2,'0')}`, rec=er.find(r=>r.date===ds)
        if(rec){ const iw=rec.code==='Я'; days.push(iw?(rec.hours%1===0?rec.hours:rec.hours.toFixed(1)):rec.code); if(iw){wd++;wh+=rec.hours} }
        else { const dow=new Date(y,m-1,d).getDay(); days.push(dow===0||dow===6?'В':'') }
      }
      const row=ws.addRow([idx+1,emp.full_name,emp.position,...days,wd,wh])
      row.alignment={horizontal:'center',vertical:'middle'}
      row.getCell(2).alignment={horizontal:'left',vertical:'middle'}
      row.getCell(3).alignment={horizontal:'left',vertical:'middle'}
    })
    res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition',`attachment; filename="timesheet_${year}_${String(m).padStart(2,'0')}.xlsx"`)
    await wb.xlsx.write(res)
  })

  // ── PDF / HTML export ─────────────────────────────────────────────────────
  app.get('/companies/:id/export/pdf/:year/:month', (req, res) => {
    const db = req.db, { year, month } = req.params
    const y = Number(year), m = Number(month)
    const prefix = `${year}-${String(m).padStart(2,'0')}`
    const daysInMonth = new Date(y, m, 0).getDate()
    const WD = {ru:['Вс','Пн','Вт','Ср','Чт','Пт','Сб'],uk:['Нд','Пн','Вт','Ср','Чт','Пт','Сб'],en:['Su','Mo','Tu','We','Th','Fr','Sa']}
    const wd = WD[req.query.lang||'uk']||WD.uk
    const MONTHS = {ru:['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'],uk:['Січень','Лютий','Березень','Квітень','Травень','Червень','Липень','Серпень','Вересень','Жовтень','Листопад','Грудень'],en:['January','February','March','April','May','June','July','August','September','October','November','December']}
    const months = MONTHS[req.query.lang||'uk']||MONTHS.uk
    const companyRow = dbGet(masterDb,'SELECT * FROM companies WHERE id=?',[req.params.id])
    const employees = dbAll(db,'SELECT * FROM employees WHERE is_active=1 ORDER BY full_name')
    const records = dbAll(db,'SELECT * FROM timesheet_records WHERE date LIKE ?',[prefix+'%'])
    const CODE_COLORS = {'Я':'#e6f7ff','О':'#fff7e6','Б':'#fff1f0','ОЗ':'#f0f0f0','Н':'#fffbe6','НН':'#ffccc7'}
    const dayHeaders = Array.from({length:daysInMonth},(_,i)=>{const d=i+1,dow=new Date(y,m-1,d).getDay(),iw=dow===0||dow===6;return `<th style="width:20px;${iw?'background:#f5f5f5;color:#aaa;':''}">${d}<br/><span style="font-size:7px">${wd[dow]}</span></th>`}).join('')
    const rows = employees.map((emp,idx)=>{
      const er=records.filter(r=>r.employee_id===emp.id); let wds=0,whs=0
      const cells=Array.from({length:daysInMonth},(_,ci)=>{const d=ci+1,dow=new Date(y,m-1,d).getDay(),iw=dow===0||dow===6,ds=`${prefix}-${String(d).padStart(2,'0')}`,rec=er.find(r=>r.date===ds),code=rec?.code||(iw?'В':''),bg=CODE_COLORS[code]??''
        if(rec&&rec.code==='Я'){wds++;whs+=rec.hours}
        const ct=rec&&rec.code==='Я'?(rec.hours%1===0?String(rec.hours):rec.hours.toFixed(1)):code
        return `<td style="${bg?`background:${bg};`:(iw&&!rec?'background:#f9f9f9;':'')}font-size:8px;">${ct}</td>`}).join('')
      return `<tr style="${idx%2===1?'background:#fafafa;':''}"><td>${idx+1}</td><td style="text-align:left;padding-left:4px;">${emp.full_name}</td><td style="text-align:left;padding-left:4px;font-size:8px;color:#555">${emp.position??''}</td>${cells}<td style="font-weight:bold">${wds}</td><td style="font-weight:bold">${whs%1===0?whs:whs.toFixed(1)}</td></tr>`
    }).join('')
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>*{box-sizing:border-box;margin:0;padding:0;}body{font-family:Arial,sans-serif;font-size:9px;}table{width:100%;border-collapse:collapse;table-layout:fixed;}th,td{border:1px solid #bbb;padding:2px 1px;text-align:center;}th{background:#e8e8e8;font-weight:bold;}@page{size:A4 landscape;margin:8mm 10mm;}@media print{*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;}}</style></head><body><div style="text-align:center;margin-bottom:10px;"><h2 style="font-size:13px">${companyRow?.name??'TVTab'} — ${months[m-1]} ${year}</h2></div><table><colgroup><col style="width:24px"/><col style="width:150px"/><col style="width:100px"/>${Array.from({length:daysInMonth},()=>'<col style="width:20px"/>').join('')}<col style="width:30px"/><col style="width:30px"/></colgroup><thead><tr><th>№</th><th>ПІБ</th><th>Посада</th>${dayHeaders}<th>Дн.</th><th>Год.</th></tr></thead><tbody>${rows}</tbody></table><script>window.print()</script></body></html>`
    res.setHeader('Content-Type','text/html; charset=utf-8'); res.send(html)
  })

  app.get('/companies/:id/export/detail-pdf/:year/:month/:empId', (req, res) => {
    const db = req.db, { year, month, empId } = req.params
    const lang = req.query.lang||'uk', colorMode = req.query.colorMode||'color'
    const y = Number(year), m = Number(month)
    const prefix = `${year}-${String(m).padStart(2,'0')}`
    const holidays = dbAll(db,'SELECT date FROM holidays WHERE date LIKE ?',[prefix+'%']).map(r=>r.date)
    const workdays2 = dbAll(db,'SELECT date FROM workdays WHERE date LIKE ?',[prefix+'%']).map(r=>r.date)
    const normDays = getWorkingDaysInMonth(y, m, holidays, workdays2)
    const hpd = dbGet(db,'SELECT value FROM settings WHERE key=?',['workHoursPerDay'])
    const hoursPerDay = Number(hpd?.value??8)
    const normHours = normDays * hoursPerDay
    const otRow = dbGet(db,'SELECT value FROM month_settings WHERE year=? AND month=? AND key=?',[y,m,'overtimeCoeff'])??dbGet(db,'SELECT value FROM settings WHERE key=?',['overtimeCoeff'])
    const overtimeCoeff = Number(otRow?.value??1.5)
    const s = calcSalaryForEmployee(db, Number(empId), y, m, normDays, normHours, hoursPerDay, overtimeCoeff)
    if (!s) return res.status(404).json({error:'Not found'})
    const companyRow = dbGet(masterDb,'SELECT * FROM companies WHERE id=?',[req.params.id])
    const currency = companyRow?.currency??'₴'
    const MONTHS = {ru:['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'],uk:['Січень','Лютий','Березень','Квітень','Травень','Червень','Липень','Серпень','Вересень','Жовтень','Листопад','Грудень'],en:['January','February','March','April','May','June','July','August','September','October','November','December']}
    const months = MONTHS[lang]||MONTHS.uk
    const bw = colorMode==='bw'
    const fmt2 = n=>n.toLocaleString('uk-UA',{minimumFractionDigits:2,maximumFractionDigits:2})
    const fmtH = n=>Number.isInteger(n)?String(n):n.toFixed(2).replace(/\.?0+$/,'')
    const CODE_COLORS = {'Я':'#e6f7ff','О':'#fff7e6','Б':'#fff1f0','ОЗ':'#f0f0f0','Н':'#fffbe6','НН':'#ffccc7'}
    const attendRows = s.rows.map((r,idx)=>{
      const isW=r.code==='Я', dow=new Date(r.date).getDay(), iswknd=dow===0||dow===6
      const ds=new Date(r.date).toLocaleDateString('uk-UA',{day:'2-digit',month:'2-digit',weekday:'short'})
      let rs=''
      if(bw){if(isW)rs=idx%2===0?'background:#f0f0f0;':'background:#e4e4e4;';else if(iswknd)rs='background:#d8d8d8;color:#555;';else rs=idx%2===1?'background:#fafafa;':'';}
      else{const bg=CODE_COLORS[r.code]??'';rs=bg?`background:${bg};`:(iswknd&&!bg?'background:#f9f9f9;':(idx%2===1?'background:#fafafa;':''));}
      return `<tr style="${rs}"><td>${idx+1}</td><td style="text-align:left">${ds}</td><td><b>${r.code}</b></td><td>${r.arrival_time??'—'}</td><td>${r.departure_time??'—'}</td><td style="text-align:right">${isW?`<b>${fmtH(r.hours)}</b>`:'—'}</td></tr>`
    }).join('')
    const otLine = s.overtimeHours>0?`<div style="margin-bottom:4px;font-size:8.5px;${bw?'font-style:italic;':'color:#d46b08;'}">Переробіток (×${overtimeCoeff}): ${fmt2(s.derivedHourlyRate)} × ${fmtH(s.overtimeHours)} год = <b>${fmt2(s.overtimeSalary)}</b></div>`:''
    const vacLine = s.vacationDays>0?`<div style="margin-bottom:4px;font-size:8.5px;${bw?'':'color:#d48b08;'}">Відпускні (${s.vacationDays} дн., ×${s.vacationCoeff}) = <b>${fmt2(s.vacationPay)}</b></div>`:''
    const sickLine = s.sickDays>0?`<div style="margin-bottom:4px;font-size:8.5px;${bw?'':'color:#cf1322;'}">Лікарняні (${s.sickDays} дн., ×${s.sickCoeff}) = <b>${fmt2(s.sickPay)}</b></div>`:''
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>*{box-sizing:border-box;margin:0;padding:0;}body{font-family:Arial,sans-serif;font-size:8.5px;color:#222;}table{width:100%;border-collapse:collapse;margin-bottom:10px;}th,td{border:1px solid ${bw?'#888':'#ccc'};padding:2px 4px;text-align:center;}th{background:${bw?'#d0d0d0':'#efefef'};font-size:8px;font-weight:bold;}td{font-size:8px;}.calc{${bw?'border:2px solid #333;':'background:#f6ffed;border:1px solid #b7eb8f;'}border-radius:4px;padding:8px 12px;}@page{size:A4 portrait;margin:8mm 10mm;}@media print{*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;}}</style></head><body><div style="text-align:center;border-bottom:2px solid #333;padding-bottom:7px;margin-bottom:10px;"><h1 style="font-size:13px">${companyRow?.name??'TVTab'}</h1><div style="font-size:10px;color:#555">Розрахунок зарплати — ${months[m-1]} ${year}</div><div style="font-size:11px;font-weight:600;margin-top:3px">${s.emp.full_name}${s.emp.position?` — ${s.emp.position}`:''}</div></div><table><thead><tr><th style="width:20px">№</th><th>Дата</th><th style="width:28px">Код</th><th style="width:42px">Прихід</th><th style="width:42px">Відхід</th><th style="width:36px">Год.</th></tr></thead><tbody>${attendRows}</tbody></table><div class="calc"><div style="font-size:8px;font-weight:bold;text-transform:uppercase;border-bottom:${bw?'2px solid #333':'1px solid #ddd'};padding-bottom:2px;margin-bottom:6px">Розрахунок</div><div style="margin-bottom:4px;font-size:8.5px">Звичайні години: ${fmt2(s.derivedHourlyRate)} × ${fmtH(s.regularHours)} год = <b>${fmt2(s.regularSalary)}</b></div>${otLine}${vacLine}${sickLine}<hr style="border:none;border-top:${bw?'2px solid #333':'1px solid #b7eb8f'};margin:6px 0;"/><div style="font-size:16px;font-weight:bold;${bw?'text-decoration:underline;':'color:#1677ff;'}">До виплати: ${fmt2(s.salary)} ${currency}</div></div><script>window.print()</script></body></html>`
    res.setHeader('Content-Type','text/html; charset=utf-8'); res.send(html)
  })

  return app
}

// ─── Get local network IP ─────────────────────────────────────────────────────
function getLocalIP() {
  const nets = os.networkInterfaces()
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) return net.address
    }
  }
  return '127.0.0.1'
}

// ─── Settings window ──────────────────────────────────────────────────────────
let settingsWin = null

function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) { settingsWin.focus(); return }
  settingsWin = new BrowserWindow({
    width: 380, height: 240,
    resizable: false, minimizable: false, maximizable: false,
    title: 'TVTab Server — Налаштування',
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  })
  settingsWin.setMenuBarVisibility(false)
  settingsWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`
<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>body{font-family:Arial,sans-serif;padding:20px;font-size:13px;}label{display:block;margin-bottom:6px;}input{width:100%;padding:6px;box-sizing:border-box;border:1px solid #d9d9d9;border-radius:4px;margin-top:2px;font-size:13px;}button{margin-top:16px;padding:8px 24px;background:#1677ff;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:13px;}button:hover{background:#0958d9;}.row{display:flex;gap:8px;align-items:flex-end;}</style>
</head><body>
<label>Порт<input id="port" type="number" value="${PORT}"/></label>
<label>Папка даних<div class="row"><input id="dir" value="${DATA_DIR.replace(/\\/g,'\\\\')}"/></div></label>
<button onclick="save()">Зберегти та перезапустити</button>
<script>
const {ipcRenderer}=require('electron')
function save(){ipcRenderer.send('save-settings',{port:Number(document.getElementById('port').value),dataDir:document.getElementById('dir').value})}
</script></body></html>
  `)}`)
}

ipcMain.on('save-settings', (e, cfg) => {
  PORT = cfg.port || PORT
  DATA_DIR = cfg.dataDir || DATA_DIR
  saveConfig({ port: PORT, dataDir: DATA_DIR })
  if (settingsWin && !settingsWin.isDestroyed()) settingsWin.close()
  restartServer()
})

// ─── Tray setup ────────────────────────────────────────────────────────────────
let tray = null

function buildContextMenu() {
  const ip = getLocalIP()
  const url = `http://${ip}:${PORT}`
  return Menu.buildFromTemplate([
    { label: 'TVTab Server', enabled: false },
    { label: `▶ Порт: ${PORT}`, enabled: false },
    { type: 'separator' },
    { label: `📋 Скопіювати ${url}`, click: () => { clipboard.writeText(url); tray.setToolTip(`Скопійовано: ${url}`) } },
    { label: `📋 Скопіювати http://localhost:${PORT}`, click: () => clipboard.writeText(`http://localhost:${PORT}`) },
    { label: '📁 Відкрити папку даних', click: () => { fs.mkdirSync(DATA_DIR, {recursive:true}); shell.openPath(DATA_DIR) } },
    { type: 'separator' },
    { label: '⚙ Налаштування', click: openSettings },
    {
      label: app.getLoginItemSettings().openAtLogin ? '✓ Автозапуск увімкнено' : '  Додати в автозапуск',
      click: () => {
        const cur = app.getLoginItemSettings().openAtLogin
        app.setLoginItemSettings({ openAtLogin: !cur })
        rebuildTrayMenu()
      }
    },
    { type: 'separator' },
    { label: '❌ Завершити', click: () => { app.quit() } },
  ])
}

function rebuildTrayMenu() {
  if (tray) tray.setContextMenu(buildContextMenu())
}

// ─── Server lifecycle ─────────────────────────────────────────────────────────
function startServer() {
  expressApp = buildExpressApp()
  server = http.createServer(expressApp)
  server.listen(PORT, () => {
    const ip = getLocalIP()
    if (tray) {
      tray.setToolTip(`TVTab Server: http://${ip}:${PORT}`)
      rebuildTrayMenu()
    }
    console.log(`TVTab Server on http://${ip}:${PORT}  (localhost:${PORT})`)
  })
  server.on('error', (err) => {
    dialog.showErrorBox('TVTab Server', `Не вдалося запустити сервер:\n${err.message}`)
  })
}

function restartServer() {
  if (server) {
    server.close(() => { expressApp = null; server = null; startServer() })
  } else {
    startServer()
  }
}

// ─── App lifecycle ────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  app.setAppUserModelId('com.tvtab.server')

  // Hide dock on macOS
  if (process.platform === 'darwin') app.dock?.hide()

  // Initialize sql.js
  await initSql()
  initMasterDb()

  // Create tray
  const iconBuf = createColorIcon(22, 119, 255)
  const icon = nativeImage.createFromBuffer(iconBuf)
  tray = new Tray(icon.resize({ width: 16, height: 16 }))
  tray.setToolTip('TVTab Server — запускається...')
  tray.setContextMenu(buildContextMenu())
  tray.on('click', () => tray.popUpContextMenu())

  // Start Express server
  startServer()
})

app.on('window-all-closed', (e) => e.preventDefault()) // keep running in tray
app.on('before-quit', () => { if (server) server.close() })

import initSqlJs, { SqlJsStatic, Database as SqlDatabase } from 'sql.js'
import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { is } from '@electron-toolkit/utils'
import { SCHEMA_SQL } from './schema'
import { companyDbPath } from './companies'

let SQL: SqlJsStatic | null = null
let db: SqlDatabase | null = null
let dbPath: string
let currentCompanyId = ''

export function getCurrentCompanyId(): string { return currentCompanyId }

function getWasmPath(): string {
  return is.dev
    ? join(process.cwd(), 'node_modules/sql.js/dist/sql-wasm.wasm')
    : join(process.resourcesPath, 'sql-wasm.wasm')
}

// Загружаем WASM один раз при старте приложения (без открытия БД)
export async function initSqlEngine(): Promise<void> {
  const wasmBinary = readFileSync(getWasmPath())
  SQL = await initSqlJs({ wasmBinary })
}

// Открываем БД конкретной компании (синхронно после initSqlEngine)
export function openCompanyDb(companyId: string): void {
  if (!SQL) throw new Error('SQL engine not initialised')
  currentCompanyId = companyId
  dbPath = companyDbPath(companyId)

  if (existsSync(dbPath)) {
    db = new SQL.Database(readFileSync(dbPath))
  } else {
    db = new SQL.Database()
  }

  db.exec(SCHEMA_SQL)

  // Column migrations — safe to re-run, column already exists error is ignored
  for (const sql of [
    'ALTER TABLE timesheet_records ADD COLUMN arrival_time TEXT',
    'ALTER TABLE timesheet_records ADD COLUMN departure_time TEXT',
    'ALTER TABLE timesheet_records ADD COLUMN overtime_coeff REAL',
  ]) {
    try { db.run(sql) } catch {}
  }

  persist()
}

export function closeCompanyDb(): void {
  if (db) { db.close(); db = null }
}

function persist(): void {
  if (!db) return
  writeFileSync(dbPath, Buffer.from(db.export()))
}

function getDb(): SqlDatabase {
  if (!db) throw new Error('No company database open')
  return db
}

export function all<T = Record<string, any>>(sql: string, params: any[] = []): T[] {
  const stmt = getDb().prepare(sql)
  stmt.bind(params)
  const rows: T[] = []
  while (stmt.step()) rows.push(stmt.getAsObject() as T)
  stmt.free()
  return rows
}

export function get<T = Record<string, any>>(sql: string, params: any[] = []): T | null {
  return all<T>(sql, params)[0] ?? null
}

export function run(sql: string, params: any[] = []): number {
  getDb().run(sql, params)
  const id = lastId()
  persist()
  return id
}

export function runNoSave(sql: string, params: any[] = []): void {
  getDb().run(sql, params)
}

export function runTx(sql: string, params: any[] = []): number {
  getDb().run(sql, params)
  return lastId()
}

function lastId(): number {
  const r = getDb().exec('SELECT last_insert_rowid()')
  return (r[0]?.values[0]?.[0] as number) ?? 0
}

export function transaction(fn: () => void): void {
  getDb().run('BEGIN')
  try {
    fn()
    getDb().run('COMMIT')
  } catch (e) {
    try { getDb().run('ROLLBACK') } catch {}
    throw e
  }
  persist()
}

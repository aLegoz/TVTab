import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, renameSync } from 'fs'
import { randomUUID } from 'crypto'

export interface CompanyRecord {
  id: string
  name: string
  currency: string   // символ: ₽ $ € ₴ и т.д.
  createdAt: string
  lastOpenedAt: string
}

function registryPath(): string {
  return join(app.getPath('userData'), 'companies.json')
}

export function companiesDir(): string {
  const dir = join(app.getPath('userData'), 'companies')
  mkdirSync(dir, { recursive: true })
  return dir
}

export function companyDbPath(id: string): string {
  return join(companiesDir(), `${id}.db`)
}

function read(): CompanyRecord[] {
  const p = registryPath()
  if (!existsSync(p)) return []
  try { return JSON.parse(readFileSync(p, 'utf-8')) } catch { return [] }
}

function write(companies: CompanyRecord[]): void {
  writeFileSync(registryPath(), JSON.stringify(companies, null, 2), 'utf-8')
}

export function listCompanies(): CompanyRecord[] {
  return read().sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt))
}

export function createCompany(name: string, currency = '₽'): CompanyRecord {
  const companies = read()
  const company: CompanyRecord = {
    id: randomUUID(),
    name: name.trim(),
    currency,
    createdAt: new Date().toISOString(),
    lastOpenedAt: new Date().toISOString()
  }
  companies.push(company)
  write(companies)
  return company
}

export function markOpened(id: string): CompanyRecord | null {
  const companies = read()
  const c = companies.find((x) => x.id === id)
  if (!c) return null
  c.lastOpenedAt = new Date().toISOString()
  write(companies)
  return c
}

export function updateCompany(id: string, data: { name?: string; currency?: string }): void {
  const companies = read()
  const c = companies.find((x) => x.id === id)
  if (!c) return
  if (data.name !== undefined) c.name = data.name.trim()
  if (data.currency !== undefined) c.currency = data.currency
  write(companies)
}

export function deleteCompany(id: string): void {
  write(read().filter((x) => x.id !== id))
  try { unlinkSync(companyDbPath(id)) } catch {}
}

// При первом запуске: мигрируем старый tvtab.db в первую компанию
export function migrateIfNeeded(): void {
  const legacyDb = join(app.getPath('userData'), 'tvtab.db')
  if (!existsSync(registryPath()) && existsSync(legacyDb)) {
    const company = createCompany('Моя компания', '₽')
    renameSync(legacyDb, companyDbPath(company.id))
  }
}

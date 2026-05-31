import { IpcMain } from 'electron'
import {
  listCompanies, createCompany, markOpened, updateCompany, deleteCompany
} from '../companies'
import { openCompanyDb, closeCompanyDb } from '../db'

export function registerCompanyHandlers(ipc: IpcMain): void {
  ipc.handle('companies:list', () => listCompanies())

  ipc.handle('companies:create', (_e, name: string, currency: string) => {
    return createCompany(name, currency)
  })

  ipc.handle('companies:open', (_e, id: string) => {
    closeCompanyDb()
    openCompanyDb(id)
    return markOpened(id)
  })

  ipc.handle('companies:update', (_e, id: string, data: { name?: string; currency?: string }) => {
    updateCompany(id, data)
    return listCompanies().find((c) => c.id === id) ?? null
  })

  ipc.handle('companies:delete', (_e, id: string) => {
    deleteCompany(id)
  })
}

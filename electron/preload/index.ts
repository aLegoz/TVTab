import { contextBridge, ipcRenderer } from 'electron'

const api = {
  companies: {
    list: () => ipcRenderer.invoke('companies:list'),
    create: (name: string, currency: string) => ipcRenderer.invoke('companies:create', name, currency),
    open: (id: string) => ipcRenderer.invoke('companies:open', id),
    update: (id: string, data: any) => ipcRenderer.invoke('companies:update', id, data),
    delete: (id: string) => ipcRenderer.invoke('companies:delete', id)
  },
  departments: {
    list: () => ipcRenderer.invoke('departments:list'),
    create: (name: string) => ipcRenderer.invoke('departments:create', name),
    delete: (id: number) => ipcRenderer.invoke('departments:delete', id)
  },
  employees: {
    list: () => ipcRenderer.invoke('employees:list'),
    create: (data: any) => ipcRenderer.invoke('employees:create', data),
    update: (id: number, data: any) => ipcRenderer.invoke('employees:update', id, data),
    delete: (id: number) => ipcRenderer.invoke('employees:delete', id)
  },
  timesheet: {
    get: (year: number, month: number) => ipcRenderer.invoke('timesheet:get', year, month),
    saveRecord: (data: any) => ipcRenderer.invoke('timesheet:saveRecord', data),
    deleteRecord: (employeeId: number, date: string) =>
      ipcRenderer.invoke('timesheet:deleteRecord', employeeId, date),
    bulkSave: (records: any[]) => ipcRenderer.invoke('timesheet:bulkSave', records)
  },
  salaryHistory: {
    list: (employeeId: number) => ipcRenderer.invoke('salaryHistory:list', employeeId),
    add: (data: any) => ipcRenderer.invoke('salaryHistory:add', data),
    delete: (id: number, employeeId: number) => ipcRenderer.invoke('salaryHistory:delete', id, employeeId)
  },
  salary: {
    summary: (year: number, month: number) => ipcRenderer.invoke('salary:summary', year, month),
    detail: (employeeId: number, year: number, month: number) => ipcRenderer.invoke('salary:detail', employeeId, year, month)
  },
  export: {
    toExcel: (year: number, month: number, lang: string) => ipcRenderer.invoke('export:toExcel', year, month, lang),
    toPdf: (year: number, month: number, lang: string) => ipcRenderer.invoke('export:toPdf', year, month, lang),
    detailToPdf: (employeeId: number, year: number, month: number, colorMode: 'color' | 'bw', lang: string) =>
      ipcRenderer.invoke('salary:exportDetailPdf', employeeId, year, month, colorMode, lang),
    salaryToExcel: (year: number, month: number, lang: string) => ipcRenderer.invoke('export:salaryToExcel', year, month, lang),
    salaryToPdf: (year: number, month: number, lang: string) => ipcRenderer.invoke('export:salaryToPdf', year, month, lang),
  },
  settings: {
    get: (key: string) => ipcRenderer.invoke('settings:get', key),
    set: (key: string, value: string) => ipcRenderer.invoke('settings:set', key, value),
    getAll: () => ipcRenderer.invoke('settings:getAll')
  },
  holidays: {
    list: (year: number, month: number) => ipcRenderer.invoke('holidays:list', year, month),
    toggle: (date: string) => ipcRenderer.invoke('holidays:toggle', date)
  },
  workdays: {
    list: (year: number, month: number) => ipcRenderer.invoke('workdays:list', year, month),
    toggle: (date: string) => ipcRenderer.invoke('workdays:toggle', date)
  },
  monthSettings: {
    get: (year: number, month: number, key: string) =>
      ipcRenderer.invoke('monthSettings:get', year, month, key),
    set: (year: number, month: number, key: string, value: string) =>
      ipcRenderer.invoke('monthSettings:set', year, month, key, value),
  },
  network: {
    findServers: (): Promise<string[]> => ipcRenderer.invoke('network:findServers')
  },
  backup: {
    getData: (): Promise<any> => ipcRenderer.invoke('backup:getData'),
    exportToFile: (): Promise<string | null> => ipcRenderer.invoke('backup:exportToFile'),
    importData: (data: any): Promise<{ ok: boolean }> => ipcRenderer.invoke('backup:importData', data),
    importFromFile: (): Promise<{ ok: boolean; reason?: string }> => ipcRenderer.invoke('backup:importFromFile'),
    getAuditLogPath: (): Promise<string | null> => ipcRenderer.invoke('backup:getAuditLogPath'),
    restoreFromAudit: (): Promise<{ restored: number; errors: number }> => ipcRenderer.invoke('backup:restoreFromAudit'),
    restoreFromAuditFile: (): Promise<{ ok: boolean; restored?: number; errors?: number; reason?: string }> => ipcRenderer.invoke('backup:restoreFromAuditFile'),
  }
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('api', api)
} else {
  // @ts-ignore
  window.api = api
}

export type Api = typeof api

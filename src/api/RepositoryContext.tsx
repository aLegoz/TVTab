import { createContext, useContext, ReactNode } from 'react'
import type { IRepository } from './IRepository'

const RepositoryContext = createContext<IRepository | null>(null)

export function RepositoryProvider({ children, repo }: { children: ReactNode; repo: IRepository }) {
  return (
    <RepositoryContext.Provider value={repo}>
      {children}
    </RepositoryContext.Provider>
  )
}

export function useRepository(): IRepository {
  const ctx = useContext(RepositoryContext)
  if (!ctx) throw new Error('useRepository must be used within RepositoryProvider')
  return ctx
}

export { RepositoryContext }

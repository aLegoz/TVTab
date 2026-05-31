import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import type { IRepository } from './IRepository'
import { LocalRepository } from './localRepo'
import { RemoteRepository } from './remoteRepo'

const RepositoryContext = createContext<IRepository | null>(null)

export function RepositoryProvider({ children }: { children: ReactNode }) {
  const [repo, setRepo] = useState<IRepository>(new LocalRepository())

  useEffect(() => {
    window.api.settings.getAll().then((all: any) => {
      if (all.mode === 'remote' && all.serverUrl) {
        setRepo(new RemoteRepository(all.serverUrl))
      } else {
        setRepo(new LocalRepository())
      }
    })
  }, [])

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

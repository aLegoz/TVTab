import { createContext, useContext, useState, type ReactNode } from 'react'

interface MonthCtx {
  year: number
  month: number
  prev: () => void
  next: () => void
}

const MonthContext = createContext<MonthCtx | null>(null)

export function MonthProvider({ children }: { children: ReactNode }) {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)

  function prev() {
    if (month === 1) { setYear(y => y - 1); setMonth(12) }
    else setMonth(m => m - 1)
  }
  function next() {
    if (month === 12) { setYear(y => y + 1); setMonth(1) }
    else setMonth(m => m + 1)
  }

  return (
    <MonthContext.Provider value={{ year, month, prev, next }}>
      {children}
    </MonthContext.Provider>
  )
}

export function useMonth(): MonthCtx {
  const ctx = useContext(MonthContext)
  if (!ctx) throw new Error('useMonth outside MonthProvider')
  return ctx
}

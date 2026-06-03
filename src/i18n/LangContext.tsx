import { createContext, useContext, useState, type ReactNode } from 'react'
import { translations, type Lang, type Translations } from './translations'

interface LangCtx {
  lang: Lang
  setLang: (l: Lang) => void
  t: Translations
}

const LangContext = createContext<LangCtx | null>(null)

function detectLang(): Lang {
  const saved = localStorage.getItem('tvtab_lang') as Lang | null
  if (saved === 'ru' || saved === 'uk' || saved === 'en') return saved
  const browser = navigator.language.slice(0, 2).toLowerCase()
  if (browser === 'ru') return 'ru'
  if (browser === 'en') return 'en'
  return 'uk'
}

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(detectLang)

  function setLang(l: Lang) {
    localStorage.setItem('tvtab_lang', l)
    setLangState(l)
  }

  return (
    <LangContext.Provider value={{ lang, setLang, t: translations[lang] }}>
      {children}
    </LangContext.Provider>
  )
}

export function useLang(): LangCtx {
  const ctx = useContext(LangContext)
  if (!ctx) throw new Error('useLang outside LangProvider')
  return ctx
}

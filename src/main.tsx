import React from 'react'
import ReactDOM from 'react-dom/client'
import { ConfigProvider } from 'antd'
import ruRU from 'antd/locale/ru_RU'
import ukUA from 'antd/locale/uk_UA'
import enUS from 'antd/locale/en_US'
import App from './App'
import { LangProvider, useLang } from './i18n/LangContext'
import type { Lang } from './i18n/translations'
import './index.css'

const LOCALES: Record<Lang, typeof ruRU> = { ru: ruRU, uk: ukUA, en: enUS }

function LocaleApp() {
  const { lang } = useLang()
  return (
    <ConfigProvider locale={LOCALES[lang]} theme={{ token: { colorPrimary: '#1677ff' } }}>
      <App />
    </ConfigProvider>
  )
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <LangProvider>
      <LocaleApp />
    </LangProvider>
  </React.StrictMode>
)

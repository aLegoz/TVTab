import { useState, createContext, useContext } from 'react'
import { HashRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { Layout, Menu, Button, Typography, Tooltip } from 'antd'
import {
  TeamOutlined, CalendarOutlined, DollarOutlined,
  SettingOutlined, SwapOutlined
} from '@ant-design/icons'
import { RepositoryProvider } from './api/RepositoryContext'
import EmployeesPage from './pages/Employees/EmployeesPage'
import TimesheetPage from './pages/Timesheet/TimesheetPage'
import SalaryPage from './pages/Salary/SalaryPage'
import SettingsPage from './pages/Settings/SettingsPage'
import CompanySelectPage from './pages/CompanySelect/CompanySelectPage'
import { useLang } from './i18n/LangContext'
import type { Lang } from './i18n/translations'
import type { Company } from './types'

const { Sider, Content } = Layout
const { Text } = Typography

interface CompanyCtx { company: Company; switchCompany: () => void }
const CompanyContext = createContext<CompanyCtx | null>(null)
export function useCompany(): CompanyCtx {
  const ctx = useContext(CompanyContext)
  if (!ctx) throw new Error('useCompany outside CompanyContext')
  return ctx
}

function AppLayout({ onSwitch }: { onSwitch: () => void }) {
  const location = useLocation()
  const navigate = useNavigate()
  const { company } = useCompany()
  const { lang, setLang, t } = useLang()
  const selectedKey = '/' + location.pathname.split('/')[1]

  const menuItems = [
    { key: '/timesheet', icon: <CalendarOutlined />, label: t.menu.timesheet },
    { key: '/employees', icon: <TeamOutlined />,    label: t.menu.employees },
    { key: '/salary',   icon: <DollarOutlined />,   label: t.menu.salary },
    { key: '/settings', icon: <SettingOutlined />,  label: t.menu.settings },
  ]

  return (
    <Layout style={{ height: '100vh' }}>
      <Sider width={200} theme="dark" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          <div style={{ padding: '16px 12px 8px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
            <Text style={{ color: '#fff', fontWeight: 700, fontSize: 15, letterSpacing: 1, display: 'block' }}>
              TVTab
            </Text>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4 }}>
              <Text style={{ color: 'rgba(255,255,255,0.65)', fontSize: 12, flex: 1 }}
                ellipsis={{ tooltip: company.name }}>
                {company.name}
              </Text>
              <Tooltip title={t.company.switchTooltip}>
                <Button
                  type="text"
                  size="small"
                  icon={<SwapOutlined />}
                  onClick={onSwitch}
                  style={{ color: 'rgba(255,255,255,0.45)', padding: 2, minWidth: 'auto' }}
                />
              </Tooltip>
            </div>
          </div>

          <Menu
            theme="dark"
            mode="inline"
            selectedKeys={[selectedKey]}
            items={menuItems}
            onClick={({ key }) => navigate(key)}
            style={{ flex: 1, overflow: 'auto' }}
          />

          <div style={{ padding: '8px 12px', borderTop: '1px solid rgba(255,255,255,0.1)', display: 'flex', gap: 2 }}>
            {(['ru', 'uk', 'en'] as Lang[]).map((l) => (
              <Button
                key={l}
                type="text"
                size="small"
                onClick={() => setLang(l)}
                style={{
                  color: lang === l ? '#1677ff' : 'rgba(255,255,255,0.35)',
                  fontWeight: lang === l ? 700 : 400,
                  padding: '0 5px',
                  minWidth: 'auto',
                  fontSize: 11,
                }}
              >
                {l.toUpperCase()}
              </Button>
            ))}
          </div>
        </div>
      </Sider>

      <Layout>
        <Content className="page-content">
          <Routes>
            <Route path="/" element={<Navigate to="/timesheet" replace />} />
            <Route path="/employees" element={<EmployeesPage />} />
            <Route path="/timesheet" element={<TimesheetPage />} />
            <Route path="/salary" element={<SalaryPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </Content>
      </Layout>
    </Layout>
  )
}

export default function App() {
  const [company, setCompany] = useState<Company | null>(null)

  if (!company) {
    return <CompanySelectPage onSelect={setCompany} />
  }

  return (
    <CompanyContext.Provider value={{ company, switchCompany: () => setCompany(null) }}>
      <RepositoryProvider>
        <HashRouter>
          <AppLayout onSwitch={() => setCompany(null)} />
        </HashRouter>
      </RepositoryProvider>
    </CompanyContext.Provider>
  )
}

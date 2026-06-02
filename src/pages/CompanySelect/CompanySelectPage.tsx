import { useState, useEffect } from 'react'
import {
  Card, Button, Modal, Form, Input, Select, Typography,
  Space, Popconfirm, Empty, Spin, Tag, Tooltip, Radio, message, Divider, List
} from 'antd'
import {
  PlusOutlined, EditOutlined, DeleteOutlined, ArrowRightOutlined,
  ApiOutlined, DisconnectOutlined, WifiOutlined
} from '@ant-design/icons'
import type { Company } from '../../types'
import { CURRENCIES } from '../../types'
import { useLang } from '../../i18n/LangContext'
import { IS_WEB } from '../../env'
import dayjs from 'dayjs'

const { Title, Text } = Typography

interface Props {
  onSelect: (company: Company, serverUrl?: string) => void
}

export default function CompanySelectPage({ onSelect }: Props) {
  const { t } = useLang()
  const [mode, setMode] = useState<'local' | 'remote'>('local')
  const [serverUrl, setServerUrl] = useState('')
  const [connected, setConnected] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [scanModal, setScanModal] = useState(false)
  const [foundServers, setFoundServers] = useState<string[]>([])

  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading] = useState(true)
  const [opening, setOpening] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Company | null>(null)
  const [form] = Form.useForm()

  // Read saved settings on mount — use localStorage to avoid IPC before company DB is open
  useEffect(() => {
    if (IS_WEB) {
      connectToServer(window.location.origin)
      return
    }
    const savedMode = localStorage.getItem('tvtab.mode') as 'local' | 'remote' | null
    const savedUrl = localStorage.getItem('tvtab.serverUrl') ?? ''
    if (savedMode === null) {
      // First run — show mode selector, don't auto-load anything
      setLoading(false)
      return
    }
    setMode(savedMode)
    setServerUrl(savedUrl)
    if (savedMode === 'local') {
      loadLocalCompanies()
    } else if (savedUrl) {
      connectToServer(savedUrl)
    } else {
      setLoading(false)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function loadLocalCompanies() {
    setLoading(true)
    window.api.companies.list().then((list: Company[]) => {
      setCompanies(list)
      setLoading(false)
    })
  }

  async function scanNetwork() {
    setScanning(true)
    setScanModal(true)
    setFoundServers([])
    try {
      const servers = await window.api.network.findServers()
      setFoundServers(servers)
    } catch {
      setFoundServers([])
    } finally {
      setScanning(false)
    }
  }

  async function connectToServer(url: string) {
    setConnecting(true)
    try {
      const res = await fetch(`${url}/companies`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setCompanies(data)
      setConnected(true)
      setMode('remote')
      setServerUrl(url)
      localStorage.setItem('tvtab.mode', 'remote')
      localStorage.setItem('tvtab.serverUrl', url)
    } catch (e: any) {
      message.error(`Не вдалося підключитися: ${e.message}`)
      setConnected(false)
    } finally {
      setConnecting(false)
      setLoading(false)
    }
  }

  function disconnect() {
    setConnected(false)
    setCompanies([])
    localStorage.setItem('tvtab.mode', 'local')
    localStorage.removeItem('tvtab.serverUrl')
  }

  async function handleModeChange(newMode: 'local' | 'remote') {
    setMode(newMode)
    setConnected(false)
    setCompanies([])
    localStorage.setItem('tvtab.mode', newMode)
    if (newMode === 'local') {
      loadLocalCompanies()
    } else {
      setLoading(false)
    }
  }

  async function handleOpen(company: Company) {
    setOpening(company.id)
    try {
      if (mode === 'remote') {
        await fetch(`${serverUrl}/companies/${company.id}/open`, { method: 'POST' })
        onSelect(company, serverUrl)
      } else {
        await window.api.companies.open(company.id)
        onSelect(company)
      }
    } finally {
      setOpening(null)
    }
  }

  function openCreate() {
    setEditTarget(null)
    form.resetFields()
    form.setFieldsValue({ currency: '₴' })
    setModalOpen(true)
  }

  function openEdit(c: Company) {
    setEditTarget(c)
    form.setFieldsValue({ name: c.name, currency: c.currency })
    setModalOpen(true)
  }

  async function handleSubmit(values: any) {
    if (mode === 'remote') {
      if (editTarget) {
        await fetch(`${serverUrl}/companies/${editTarget.id}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: values.name, currency: values.currency })
        })
      } else {
        await fetch(`${serverUrl}/companies`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: values.name, currency: values.currency })
        })
      }
      const res = await fetch(`${serverUrl}/companies`)
      setCompanies(await res.json())
    } else {
      if (editTarget) {
        await window.api.companies.update(editTarget.id, { name: values.name, currency: values.currency })
      } else {
        await window.api.companies.create(values.name, values.currency)
      }
      loadLocalCompanies()
    }
    setModalOpen(false)
  }

  async function handleDelete(id: string) {
    if (mode === 'remote') {
      await fetch(`${serverUrl}/companies/${id}`, { method: 'DELETE' })
      setCompanies((prev) => prev.filter((c) => c.id !== id))
    } else {
      await window.api.companies.delete(id)
      setCompanies((prev) => prev.filter((c) => c.id !== id))
    }
  }

  const showCompanies = IS_WEB ? connected : (mode === 'local' || (mode === 'remote' && connected))

  return (
    <div style={{
      minHeight: '100vh', background: '#f0f2f5',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', padding: 32
    }}>
      <div style={{ width: '100%', maxWidth: 680 }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <Title level={2} style={{ margin: 0 }}>{t.company.title}</Title>
          <Text type="secondary">{t.company.subtitle}</Text>
        </div>

        {/* Mode selector — hidden in web/browser mode */}
        {IS_WEB && connected && (
          <Card size="small" style={{ marginBottom: 16 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              ✓ {serverUrl}
            </Text>
          </Card>
        )}
        {!IS_WEB && <Card size="small" style={{ marginBottom: 16 }}>
          <Radio.Group value={mode} onChange={(e) => handleModeChange(e.target.value)}>
            <Radio value="local">{t.settings.local}</Radio>
            <Radio value="remote">{t.settings.remote}</Radio>
          </Radio.Group>

          {mode === 'remote' && (
            <>
              <Divider style={{ margin: '10px 0' }} />
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <Input
                  value={serverUrl}
                  onChange={(e) => setServerUrl(e.target.value)}
                  placeholder="http://192.168.1.100:3001"
                  style={{ flex: 1 }}
                  onPressEnter={() => connectToServer(serverUrl)}
                  disabled={connected}
                />
                <Tooltip title="Знайти сервер в мережі">
                  <Button
                    icon={<WifiOutlined />}
                    onClick={scanNetwork}
                    loading={scanning}
                    disabled={connected}
                  />
                </Tooltip>
                {!connected ? (
                  <Button
                    type="primary"
                    icon={<ApiOutlined />}
                    loading={connecting}
                    onClick={() => connectToServer(serverUrl)}
                    disabled={!serverUrl}
                  >
                    {t.settings.remote}
                  </Button>
                ) : (
                  <Button icon={<DisconnectOutlined />} onClick={disconnect} danger>
                    {t.settings.local}
                  </Button>
                )}
              </div>
              {connected && (
                <Text type="success" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
                  ✓ {serverUrl}
                </Text>
              )}
            </>
          )}
        </Card>}

        {/* Companies list */}
        {showCompanies && (
          <Spin spinning={loading}>
            {!loading && companies.length === 0 && (
              <Card style={{ textAlign: 'center', marginBottom: 16, padding: '8px 0' }}>
                <Empty description={t.company.noCompanies} image={Empty.PRESENTED_IMAGE_SIMPLE}>
                  <Button type="primary" icon={<PlusOutlined />} size="large" onClick={openCreate}>
                    {t.company.create}
                  </Button>
                </Empty>
              </Card>
            )}

            <Space direction="vertical" style={{ width: '100%' }} size={12}>
              {companies.map((c) => (
                <Card key={c.id} size="small" style={{ borderRadius: 8 }} bodyStyle={{ padding: '12px 16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontWeight: 600, fontSize: 15 }}>{c.name}</span>
                        <Tag style={{ fontFamily: 'monospace' }}>{c.currency}</Tag>
                      </div>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {t.company.lastOpened} {dayjs(c.lastOpenedAt).format('DD.MM.YYYY HH:mm')}
                      </Text>
                    </div>
                    <Space>
                      <Tooltip title={t.company.edit}>
                        <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(c)} />
                      </Tooltip>
                      <Popconfirm
                        title={t.company.deleteTitle}
                        description={t.company.deleteDesc}
                        onConfirm={() => handleDelete(c.id)}
                        okText={t.company.deleteOk}
                        okButtonProps={{ danger: true }}
                      >
                        <Tooltip title={t.company.delete}>
                          <Button size="small" danger icon={<DeleteOutlined />} />
                        </Tooltip>
                      </Popconfirm>
                      <Button
                        type="primary"
                        icon={<ArrowRightOutlined />}
                        loading={opening === c.id}
                        onClick={() => handleOpen(c)}
                      >
                        {t.company.open}
                      </Button>
                    </Space>
                  </div>
                </Card>
              ))}
            </Space>

            <div style={{ marginTop: 16, textAlign: 'center' }}>
              <Button type="dashed" icon={<PlusOutlined />} size="large" onClick={openCreate}>
                {t.company.create}
              </Button>
            </div>
          </Spin>
        )}
      </div>

      {/* Network scan results */}
      <Modal
        title={<><WifiOutlined /> Сервери TVTab в мережі</>}
        open={scanModal}
        onCancel={() => setScanModal(false)}
        footer={null}
        width={400}
      >
        <Spin spinning={scanning} tip="Сканування мережі... (3 сек)">
          {!scanning && foundServers.length === 0 && (
            <Empty description="Серверів не знайдено" image={Empty.PRESENTED_IMAGE_SIMPLE}
              style={{ margin: '16px 0' }} />
          )}
          {foundServers.length > 0 && (
            <List
              dataSource={foundServers}
              renderItem={(url) => (
                <List.Item
                  actions={[
                    <Button type="primary" size="small"
                      onClick={() => { setServerUrl(url); setScanModal(false) }}>
                      Вибрати
                    </Button>
                  ]}
                >
                  <span style={{ fontFamily: 'monospace', fontSize: 14 }}>{url}</span>
                </List.Item>
              )}
            />
          )}
        </Spin>
      </Modal>

      <Modal
        title={editTarget ? t.company.modalEdit : t.company.modalCreate}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={() => form.submit()}
        destroyOnClose
        width={360}
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit} style={{ marginTop: 8 }}>
          <Form.Item name="name" label={t.company.name} rules={[{ required: true, message: t.company.nameRequired }]}>
            <Input placeholder={t.company.namePlaceholder} />
          </Form.Item>
          <Form.Item name="currency" label={t.company.currency} rules={[{ required: true }]}>
            <Select options={CURRENCIES.map((c) => ({ value: c.symbol, label: c.label }))} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

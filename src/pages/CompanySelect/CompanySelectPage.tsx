import { useState, useEffect } from 'react'
import {
  Card, Button, Modal, Form, Input, Select, Typography,
  Space, Popconfirm, Empty, Spin, Tag, Tooltip
} from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined, ArrowRightOutlined } from '@ant-design/icons'
import type { Company } from '../../types'
import { CURRENCIES } from '../../types'
import { useLang } from '../../i18n/LangContext'
import dayjs from 'dayjs'

const { Title, Text } = Typography

interface Props {
  onSelect: (company: Company) => void
}

export default function CompanySelectPage({ onSelect }: Props) {
  const { t } = useLang()
  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading] = useState(true)
  const [opening, setOpening] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Company | null>(null)
  const [form] = Form.useForm()

  useEffect(() => {
    window.api.companies.list().then((list: Company[]) => {
      setCompanies(list)
      setLoading(false)
    })
  }, [])

  async function handleOpen(company: Company) {
    setOpening(company.id)
    try {
      await window.api.companies.open(company.id)
      onSelect(company)
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
    if (editTarget) {
      await window.api.companies.update(editTarget.id, {
        name: values.name,
        currency: values.currency
      })
    } else {
      await window.api.companies.create(values.name, values.currency)
    }
    const list = await window.api.companies.list()
    setCompanies(list)
    setModalOpen(false)
  }

  async function handleDelete(id: string) {
    await window.api.companies.delete(id)
    setCompanies((prev) => prev.filter((c) => c.id !== id))
  }

  return (
    <div style={{
      minHeight: '100vh', background: '#f0f2f5',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', padding: 32
    }}>
      <div style={{ width: '100%', maxWidth: 680 }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <Title level={2} style={{ margin: 0 }}>{t.company.title}</Title>
          <Text type="secondary">{t.company.subtitle}</Text>
        </div>

        <Spin spinning={loading}>
          {!loading && companies.length === 0 && (
            <Card style={{ textAlign: 'center', marginBottom: 16 }}>
              <Empty description={t.company.noCompanies} image={Empty.PRESENTED_IMAGE_SIMPLE} />
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
      </div>

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

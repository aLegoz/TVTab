import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Table, Button, Modal, Form, Input, Select, InputNumber,
  DatePicker, Space, Tag, Popconfirm, Typography, message,
  Divider, Empty
} from 'antd'
import { PlusOutlined, EditOutlined, StopOutlined, DeleteOutlined, HistoryOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { useRepository } from '../../api/RepositoryContext'
import { useCompany } from '../../App'
import { useLang } from '../../i18n/LangContext'
import type { Employee, Department, SalaryHistoryEntry } from '../../types'

const { Title, Text } = Typography

export default function EmployeesPage() {
  const repo = useRepository()
  const { company } = useCompany()
  const { t } = useLang()
  const cur = company.currency

  const [employees, setEmployees] = useState<Employee[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Employee | null>(null)
  const [history, setHistory] = useState<SalaryHistoryEntry[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [addRateOpen, setAddRateOpen] = useState(false)
  const [rateForm] = Form.useForm()
  const [form] = Form.useForm()

  const rateLabel = (rateType: string) =>
    rateType === 'hourly'
      ? `${cur}${t.employees.perHour}`
      : `${cur}${t.employees.perMonth}`

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [emps, depts] = await Promise.all([repo.listEmployees(), repo.listDepartments()])
      setEmployees(emps)
      setDepartments(depts)
    } finally {
      setLoading(false)
    }
  }, [repo])

  useEffect(() => { load() }, [load])

  const loadRef = useRef(load)
  useEffect(() => { loadRef.current = load }, [load])
  useEffect(() => repo.subscribeToChanges(() => loadRef.current()), [repo])

  async function loadHistory(emp: Employee) {
    setHistoryLoading(true)
    try {
      const h = await repo.getSalaryHistory(emp.id)
      setHistory(h)
    } finally {
      setHistoryLoading(false)
    }
  }

  function openCreate() {
    setEditing(null)
    setHistory([])
    form.resetFields()
    setModalOpen(true)
  }

  function openEdit(emp: Employee) {
    setEditing(emp)
    form.setFieldsValue({
      fullName: emp.fullName,
      position: emp.position,
      departmentId: emp.departmentId,
      hiredDate: emp.hiredDate ? dayjs(emp.hiredDate) : null
    })
    loadHistory(emp)
    setModalOpen(true)
  }

  async function handleSubmit(values: any) {
    const hiredDate = values.hiredDate ? dayjs(values.hiredDate).format('YYYY-MM-DD') : ''
    try {
      if (editing) {
        await repo.updateEmployee(editing.id, {
          fullName: values.fullName,
          position: values.position || '',
          departmentId: values.departmentId ?? null,
          rateType: editing.rateType,
          rate: editing.rate,
          hiredDate,
          isActive: editing.isActive
        })
        message.success(t.employees.updated)
      } else {
        await repo.createEmployee({
          fullName: values.fullName,
          position: values.position || '',
          departmentId: values.departmentId ?? null,
          rateType: values.rateType,
          rate: values.rate,
          hiredDate
        })
        message.success(t.employees.created)
      }
      setModalOpen(false)
      load()
    } catch (e: any) {
      message.error(e.message)
    }
  }

  async function handleAddRate(values: any) {
    if (!editing) return
    try {
      await repo.addSalaryHistory({
        employeeId: editing.id,
        effectiveFrom: dayjs(values.effectiveFrom).format('YYYY-MM-DD'),
        rateType: values.rateType,
        rate: values.rate,
        note: values.note || ''
      })
      message.success(t.employees.rateSaved)
      setAddRateOpen(false)
      rateForm.resetFields()
      await loadHistory(editing)
      load()
    } catch (e: any) {
      message.error(e.message)
    }
  }

  async function handleDeleteRate(entry: SalaryHistoryEntry) {
    if (!editing) return
    if (history.length <= 1) {
      message.warning(t.employees.lastRateWarning)
      return
    }
    try {
      await repo.deleteSalaryHistory(entry.id, editing.id)
      message.success(t.employees.rateDeleted)
      await loadHistory(editing)
      load()
    } catch (e: any) {
      message.error(e.message)
    }
  }

  async function handleDeactivate(id: number) {
    await repo.deleteEmployee(id)
    message.success(t.employees.deactivated)
    load()
  }

  const historyColumns = [
    {
      title: t.employees.colFrom, dataIndex: 'effectiveFrom', key: 'effectiveFrom',
      render: (v: string) => dayjs(v).format('DD.MM.YYYY')
    },
    {
      title: t.employees.colRateVal, key: 'rate',
      render: (_: any, r: SalaryHistoryEntry) =>
        <span style={{ fontWeight: 600 }}>
          {r.rate.toLocaleString('ru-RU')} {rateLabel(r.rateType)}
        </span>
    },
    { title: t.employees.colNote, dataIndex: 'note', key: 'note', render: (v: string) => v || '—' },
    {
      title: '', key: 'del', width: 40,
      render: (_: any, r: SalaryHistoryEntry) => (
        <Popconfirm title={t.employees.rateDeleted} onConfirm={() => handleDeleteRate(r)}>
          <Button size="small" danger icon={<DeleteOutlined />} />
        </Popconfirm>
      )
    }
  ]

  const mainColumns = [
    { title: t.employees.colNum, width: 50, render: (_: any, __: any, i: number) => i + 1 },
    { title: t.employees.colName, dataIndex: 'fullName', key: 'fullName' },
    { title: t.employees.colPosition, dataIndex: 'position', key: 'position', render: (v: string) => v || '—' },
    { title: t.employees.colDept, key: 'dept', render: (_: any, r: Employee) => r.departmentName || '—' },
    {
      title: t.employees.colRate, key: 'rate',
      render: (_: any, r: Employee) =>
        `${r.rate.toLocaleString('ru-RU')} ${rateLabel(r.rateType)}`
    },
    {
      title: t.employees.colStatus, key: 'status', width: 100,
      render: (_: any, r: Employee) =>
        r.isActive
          ? <Tag color="green">{t.employees.active}</Tag>
          : <Tag color="default">{t.employees.inactive}</Tag>
    },
    {
      title: '', key: 'actions', width: 100,
      render: (_: any, r: Employee) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)} />
          {r.isActive && (
            <Popconfirm title={t.employees.deactivateConfirm} onConfirm={() => handleDeactivate(r.id)}>
              <Button size="small" danger icon={<StopOutlined />} />
            </Popconfirm>
          )}
        </Space>
      )
    }
  ]

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>{t.employees.title}</Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>{t.employees.add}</Button>
      </div>

      <Table
        dataSource={employees}
        columns={mainColumns}
        rowKey="id"
        loading={loading}
        size="small"
        pagination={false}
      />

      <Modal
        title={editing ? editing.fullName : t.employees.modalNew}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={() => form.submit()}
        width={580}
        destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit} style={{ marginTop: 8 }}>
          <Form.Item name="fullName" label={t.employees.labelName} rules={[{ required: true, message: t.employees.labelName }]}>
            <Input placeholder={t.employees.namePlaceholder} />
          </Form.Item>
          <Form.Item name="position" label={t.employees.labelPosition}>
            <Input placeholder={t.employees.positionPlaceholder} />
          </Form.Item>
          <Form.Item name="departmentId" label={t.employees.labelDept}>
            <Select allowClear placeholder={t.employees.noDept}
              options={departments.map((d) => ({ value: d.id, label: d.name }))} />
          </Form.Item>
          <Form.Item name="hiredDate" label={t.employees.labelHiredDate}>
            <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" />
          </Form.Item>

          {!editing && (
            <>
              <Divider style={{ margin: '8px 0' }}>{t.employees.initialRate}</Divider>
              <Space.Compact style={{ width: '100%' }}>
                <Form.Item name="rateType" style={{ width: 180, marginBottom: 0 }} initialValue="monthly" rules={[{ required: true }]}>
                  <Select options={[
                    { value: 'monthly', label: `${t.employees.rateMonthly} (${cur}${t.employees.perMonth})` },
                    { value: 'hourly',  label: `${t.employees.rateHourly} (${cur}${t.employees.perHour})` }
                  ]} />
                </Form.Item>
                <Form.Item name="rate" style={{ flex: 1, marginBottom: 0 }} rules={[{ required: true, message: ' ' }]}>
                  <InputNumber min={0} style={{ width: '100%' }} placeholder="50 000" />
                </Form.Item>
              </Space.Compact>
            </>
          )}
        </Form>

        {editing && (
          <div style={{ marginTop: 16 }}>
            <Divider style={{ margin: '0 0 8px' }}>
              <Space>
                <HistoryOutlined />
                <span>{t.employees.historyTitle}</span>
              </Space>
            </Divider>

            {history.length === 0 && !historyLoading ? (
              <Empty description={t.employees.noHistory} image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ margin: '8px 0' }} />
            ) : (
              <Table
                dataSource={history}
                columns={historyColumns}
                rowKey="id"
                size="small"
                pagination={false}
                loading={historyLoading}
                style={{ marginBottom: 8 }}
              />
            )}

            <Button
              size="small"
              icon={<PlusOutlined />}
              onClick={() => {
                rateForm.resetFields()
                setAddRateOpen(true)
              }}
            >
              {t.employees.addRate}
            </Button>
          </div>
        )}
      </Modal>

      <Modal
        title={t.employees.rateModal}
        open={addRateOpen}
        onCancel={() => setAddRateOpen(false)}
        onOk={() => rateForm.submit()}
        destroyOnClose
        width={380}
      >
        <Form form={rateForm} layout="vertical" onFinish={handleAddRate} style={{ marginTop: 8 }}>
          <Form.Item
            name="effectiveFrom"
            label={t.employees.effectiveFrom}
            rules={[{ required: true, message: t.employees.effectiveFrom }]}
          >
            <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" />
          </Form.Item>
          <Form.Item name="rateType" label={t.employees.rateType} initialValue="monthly" rules={[{ required: true }]}>
            <Select options={[
              { value: 'monthly', label: `${t.employees.rateMonthly} (${cur}${t.employees.perMonth})` },
              { value: 'hourly',  label: `${t.employees.rateHourly} (${cur}${t.employees.perHour})` }
            ]} />
          </Form.Item>
          <Form.Item name="rate" label={`${t.employees.rateAmount} (${cur})`} rules={[{ required: true, message: ' ' }]}>
            <InputNumber min={0} style={{ width: '100%' }} placeholder="60 000" />
          </Form.Item>
          <Form.Item name="note" label={t.employees.rateNote}>
            <Input placeholder={t.employees.rateNotePlaceholder} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}

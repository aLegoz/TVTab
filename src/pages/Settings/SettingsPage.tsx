import { useState, useEffect } from 'react'
import {
  Form, Radio, Input, InputNumber, Button, Card, Typography, message,
  Divider, Space, Select, TimePicker, Tag
} from 'antd'
import { useRepository } from '../../api/RepositoryContext'
import { useLang } from '../../i18n/LangContext'
import type { Lang } from '../../i18n/translations'
import type { AppSettings } from '../../types'
import dayjs from 'dayjs'

const { Title, Text } = Typography

function toMins(t: string) {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

function calcHours(start: string, lunchStart: string, lunchEnd: string, end: string): number {
  const total = toMins(end) - toMins(start)
  const lunch = toMins(lunchEnd) - toMins(lunchStart)
  return Math.round((total - lunch) / 60 * 10) / 10
}

const tp = (s: string) => dayjs(s, 'HH:mm')

export default function SettingsPage() {
  const repo = useRepository()
  const { lang, setLang, t } = useLang()
  const [form] = Form.useForm()
  const [mode, setMode] = useState<'local' | 'remote'>('local')
  const [loading, setLoading] = useState(false)
  const [scheduleHours, setScheduleHours] = useState<number>(8)

  useEffect(() => {
    repo.getSettings().then((s: AppSettings) => {
      setMode(s.mode)
      form.setFieldsValue({
        mode: s.mode,
        serverUrl: s.serverUrl,
        scheduleStart: tp(s.scheduleStart),
        scheduleLunchStart: tp(s.scheduleLunchStart),
        scheduleLunchEnd: tp(s.scheduleLunchEnd),
        scheduleEnd: tp(s.scheduleEnd),
        overtimeCoeff: s.overtimeCoeff,
      })
      setScheduleHours(calcHours(s.scheduleStart, s.scheduleLunchStart, s.scheduleLunchEnd, s.scheduleEnd))
    })
  }, [repo, form])

  function onTimeChange() {
    const v = form.getFieldsValue(['scheduleStart', 'scheduleLunchStart', 'scheduleLunchEnd', 'scheduleEnd'])
    if (v.scheduleStart && v.scheduleLunchStart && v.scheduleLunchEnd && v.scheduleEnd) {
      const h = calcHours(
        v.scheduleStart.format('HH:mm'),
        v.scheduleLunchStart.format('HH:mm'),
        v.scheduleLunchEnd.format('HH:mm'),
        v.scheduleEnd.format('HH:mm')
      )
      setScheduleHours(h > 0 ? h : 0)
    }
  }

  async function handleSave(values: any) {
    setLoading(true)
    try {
      const start = values.scheduleStart?.format('HH:mm') ?? '08:30'
      const lunchStart = values.scheduleLunchStart?.format('HH:mm') ?? '12:30'
      const lunchEnd = values.scheduleLunchEnd?.format('HH:mm') ?? '13:00'
      const end = values.scheduleEnd?.format('HH:mm') ?? '17:00'
      const hours = calcHours(start, lunchStart, lunchEnd, end)
      const hoursPerDay = String(hours > 0 ? hours : 8)
      const overtime = String(values.overtimeCoeff ?? 1.5)

      const isRemote = localStorage.getItem('tvtab.mode') === 'remote'
      if (isRemote) {
        localStorage.setItem('tvtab.workHoursPerDay', hoursPerDay)
        localStorage.setItem('tvtab.scheduleStart', start)
        localStorage.setItem('tvtab.scheduleLunchStart', lunchStart)
        localStorage.setItem('tvtab.scheduleLunchEnd', lunchEnd)
        localStorage.setItem('tvtab.scheduleEnd', end)
        localStorage.setItem('tvtab.overtimeCoeff', overtime)
      } else {
        await window.api.settings.set('mode', values.mode)
        await window.api.settings.set('serverUrl', values.serverUrl || '')
        await window.api.settings.set('workHoursPerDay', hoursPerDay)
        await window.api.settings.set('scheduleStart', start)
        await window.api.settings.set('scheduleLunchStart', lunchStart)
        await window.api.settings.set('scheduleLunchEnd', lunchEnd)
        await window.api.settings.set('scheduleEnd', end)
        await window.api.settings.set('overtimeCoeff', overtime)
      }

      message.success(t.settings.savedMsg)
    } catch (e: any) {
      message.error(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ maxWidth: 520 }}>
      <Title level={4} style={{ marginBottom: 24 }}>{t.settings.title}</Title>

      <Card size="small" title={t.settings.language} style={{ marginBottom: 16 }}>
        <Select
          value={lang}
          onChange={(v) => setLang(v as Lang)}
          style={{ width: 200 }}
          options={[
            { value: 'ru', label: t.langNames.ru },
            { value: 'uk', label: t.langNames.uk },
            { value: 'en', label: t.langNames.en },
          ]}
        />
      </Card>

      <Form form={form} layout="vertical" onFinish={handleSave}>

        <Card size="small" title={t.settings.schedule} style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <Form.Item name="scheduleStart" label={t.settings.scheduleStart} style={{ marginBottom: 0 }}>
              <TimePicker format="HH:mm" minuteStep={5} style={{ width: 110 }} onChange={onTimeChange} />
            </Form.Item>

            <Form.Item label={t.settings.lunch} style={{ marginBottom: 0 }}>
              <Space>
                <Form.Item name="scheduleLunchStart" noStyle>
                  <TimePicker format="HH:mm" minuteStep={5} style={{ width: 110 }} onChange={onTimeChange} />
                </Form.Item>
                <span style={{ color: '#999' }}>—</span>
                <Form.Item name="scheduleLunchEnd" noStyle>
                  <TimePicker format="HH:mm" minuteStep={5} style={{ width: 110 }} onChange={onTimeChange} />
                </Form.Item>
              </Space>
            </Form.Item>

            <Form.Item name="scheduleEnd" label={t.settings.scheduleEnd} style={{ marginBottom: 0 }}>
              <TimePicker format="HH:mm" minuteStep={5} style={{ width: 110 }} onChange={onTimeChange} />
            </Form.Item>

            <Form.Item label=" " style={{ marginBottom: 0 }}>
              <Tag color="blue" style={{ fontSize: 13, padding: '2px 10px' }}>
                = {scheduleHours} {t.settings.hoursCalc}
              </Tag>
            </Form.Item>
          </div>

          <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13 }}>{t.settings.overtimeCoeff}:</span>
            <Form.Item name="overtimeCoeff" noStyle initialValue={1.5}>
              <InputNumber min={1} max={5} step={0.1} precision={2} style={{ width: 90 }} />
            </Form.Item>
          </div>
        </Card>

        {localStorage.getItem('tvtab.mode') !== 'remote' && (
          <Card size="small" title={t.settings.connectionMode} style={{ marginBottom: 16 }}>
            <Form.Item name="mode" noStyle>
              <Radio.Group onChange={(e) => setMode(e.target.value)}>
                <Space direction="vertical">
                  <Radio value="local">
                    <span style={{ fontWeight: 600 }}>{t.settings.local}</span>
                    <br />
                    <Text type="secondary" style={{ fontSize: 12 }}>{t.settings.localDesc}</Text>
                  </Radio>
                  <Radio value="remote">
                    <span style={{ fontWeight: 600 }}>{t.settings.remote}</span>
                    <br />
                    <Text type="secondary" style={{ fontSize: 12 }}>{t.settings.remoteDesc}</Text>
                  </Radio>
                </Space>
              </Radio.Group>
            </Form.Item>

            {mode === 'remote' && (
              <>
                <Divider style={{ margin: '12px 0' }} />
                <Form.Item
                  name="serverUrl"
                  label={t.settings.serverUrl}
                  rules={[{ required: true, message: t.settings.serverUrlRequired }]}
                >
                  <Input placeholder="http://192.168.1.100:3000/api" />
                </Form.Item>
              </>
            )}
          </Card>
        )}

        <Button type="primary" htmlType="submit" loading={loading}>
          {t.settings.save}
        </Button>
      </Form>
    </div>
  )
}

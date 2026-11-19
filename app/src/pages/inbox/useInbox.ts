import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { thaiError } from '../../data/live'
import { rpc } from '../../data/useFactoryData'
import type { InboxItem, InboxKind } from './format'

type MessageRow = {
  id: number
  kind: InboxKind
  job_id: string | null
  title: string
  body: string
  created_at: string
}

type ReadRow = {
  message_id: number
}

export type InboxState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; items: InboxItem[] }

const SCAN_INTERVAL_MS = 5 * 60_000
// กระดิ่ง 2 จุด + หน้ากล่องจดหมายเรียก hook พร้อมกัน · สแกนครั้งเดียวต่อรอบต่อเครื่องก็พอ
const SCAN_MIN_GAP_MS = 60_000
let lastScanAt = 0
// realtime-js คืนช่องเดิมถ้าชื่อซ้ำ แล้ว .on() หลัง subscribe() จะ throw · และถอดช่องเมื่อ unmount จะตัดของจุดอื่น
let channelSeq = 0

async function loadInbox(): Promise<InboxItem[]> {
  if (!supabase) throw new Error('ยังไม่ได้ตั้งค่า Supabase')
  const [msgs, reads] = await Promise.all([
    supabase
      .from('inbox_messages')
      .select('id, kind, job_id, title, body, created_at')
      .order('created_at', { ascending: false })
      .limit(200),
    supabase.from('inbox_reads').select('message_id'),
  ])
  const err = msgs.error ?? reads.error
  if (err) throw new Error(err.message)

  const readIds = new Set((reads.data as ReadRow[]).map(r => r.message_id))
  return (msgs.data as MessageRow[]).map(m => ({
    id: m.id,
    kind: m.kind,
    jobId: m.job_id,
    title: m.title,
    body: m.body,
    createdAt: new Date(m.created_at),
    read: readIds.has(m.id),
  }))
}

export function useInbox() {
  const [state, setState] = useState<InboxState>({ status: 'loading' })
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const seq = useRef(0)

  const refresh = useCallback(async () => {
    const mine = ++seq.current
    try {
      const items = await loadInbox()
      if (mine === seq.current) {
        setState({ status: 'ready', items })
      }
    } catch (e) {
      if (mine !== seq.current) return
      const message = thaiError(e instanceof Error ? e.message : undefined)
      setState(s => (s.status === 'ready' ? s : { status: 'error', message }))
    }
  }, [])

  const runScan = useCallback(async () => {
    if (Date.now() - lastScanAt < SCAN_MIN_GAP_MS) return
    lastScanAt = Date.now()
    const res = await rpc<number>('inbox_scan', {})
    if (res.ok && res.data > 0) {
      void refresh()
    }
  }, [refresh])

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined = setTimeout(() => {
      void refresh()
      void runScan()
    }, 0)

    const scanTimer = setInterval(() => void runScan(), SCAN_INTERVAL_MS)
    const client = supabase
    if (!client) {
      return () => {
        clearTimeout(timer)
        clearInterval(scanTimer)
      }
    }

    const soon = () => {
      clearTimeout(timer)
      timer = setTimeout(() => void refresh(), 250)
    }

    const channel = client
      .channel(`inbox-live-${++channelSeq}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inbox_messages' }, soon)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inbox_reads' }, soon)
      .subscribe(status => {
        if (status === 'SUBSCRIBED') soon()
      })

    const onOnline = () => soon()
    const onVisible = () => {
      if (document.visibilityState === 'visible') soon()
    }
    window.addEventListener('online', onOnline)
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      clearTimeout(timer)
      clearInterval(scanTimer)
      window.removeEventListener('online', onOnline)
      document.removeEventListener('visibilitychange', onVisible)
      void client.removeChannel(channel)
    }
  }, [refresh, runScan])

  const unreadCount = useMemo(
    () => (state.status === 'ready' ? state.items.filter(item => !item.read).length : 0),
    [state],
  )

  const markRead = useCallback(
    async (id: number) => {
      setActionError(null)
      setState(s =>
        s.status === 'ready'
          ? { ...s, items: s.items.map(item => (item.id === id ? { ...item, read: true } : item)) }
          : s,
      )
      const res = await rpc('inbox_mark_read', { p_ids: [id] })
      if (!res.ok) {
        setActionError(res.reason)
        void refresh()
      }
    },
    [refresh],
  )

  const markAllRead = useCallback(async () => {
    setBusy(true)
    setActionError(null)
    try {
      const res = await rpc('inbox_mark_all_read', {})
      if (!res.ok) {
        setActionError(res.reason)
        return
      }
      setState(s =>
        s.status === 'ready' ? { ...s, items: s.items.map(item => ({ ...item, read: true })) } : s,
      )
    } finally {
      setBusy(false)
    }
  }, [])

  return { state, unreadCount, busy, actionError, markRead, markAllRead, refresh }
}

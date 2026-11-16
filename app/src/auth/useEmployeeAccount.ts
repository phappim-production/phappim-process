import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { isEmployeeRole, type EmployeeRole } from './access'

type EmployeeProfile = { name: string; role: EmployeeRole }

type ProfileResult =
  | { status: 'ready'; profile: EmployeeProfile }
  | { status: 'unassigned' | 'inactive' | 'error' }

export function useEmployeeAccount() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [lookup, setLookup] = useState<{ userId: string; result: ProfileResult } | null>(null)
  const [revision, setRevision] = useState(0)
  const userId = session?.user.id

  useEffect(() => {
    if (!supabase) return
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      if (!nextSession) setLookup(null)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    const db = supabase
    if (!db || !userId) return
    let request: AbortController | undefined

    async function loadProfile() {
      if (!db || !userId) return
      request?.abort()
      const currentRequest = new AbortController()
      request = currentRequest
      const { data, error } = await db
        .from('profiles')
        .select('name, role, active')
        .eq('user_id', userId)
        .abortSignal(currentRequest.signal)
        .maybeSingle()

      if (currentRequest.signal.aborted) return
      let result: ProfileResult
      if (error) result = { status: 'error' }
      else if (!data || !isEmployeeRole(data.role)) result = { status: 'unassigned' }
      else if (!data.active) result = { status: 'inactive' }
      else result = { status: 'ready', profile: { name: data.name, role: data.role } }
      setLookup({ userId, result })
    }

    void loadProfile()
    window.addEventListener('focus', loadProfile)
    return () => {
      request?.abort()
      window.removeEventListener('focus', loadProfile)
    }
  }, [userId, revision])

  return {
    session,
    result: lookup?.userId === userId ? lookup?.result : undefined,
    retry() {
      setLookup(null)
      setRevision(current => current + 1)
    },
  }
}

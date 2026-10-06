'use client'

// api-client — Bearer avtentikacija + preprost useApi hook (TanStack Query je na voljo za zahtevnejše module)

import { useCallback, useEffect, useState } from 'react'
import { useAppStore } from '@/lib/store'

export class ApiError extends Error {
  status: number
  detail?: string
  constructor (status: number, error: string, detail?: string) {
    super(error)
    this.status = status
    this.detail = detail
  }
}

async function request<T> (path: string, method: string, body?: unknown): Promise<T> {
  const token = useAppStore.getState().token
  const res = await fetch(path, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (res.status === 401) {
    // seja je potekla / žeton neveljaven
    useAppStore.getState().clearAuth()
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new ApiError(res.status, (data as { error?: string }).error ?? 'Napaka strežnika', (data as { detail?: string }).detail)
  }
  return data as T
}

export const apiGet = <T,>(path: string) => request<T>(path, 'GET')
export const apiPost = <T,>(path: string, body?: unknown) => request<T>(path, 'POST', body ?? {})
export const apiPatch = <T,>(path: string, body?: unknown) => request<T>(path, 'PATCH', body ?? {})
export const apiDelete = <T,>(path: string) => request<T>(path, 'DELETE')

export function useApi<T> (path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(!!path)
  const [error, setError] = useState<ApiError | null>(null)

  const reload = useCallback(async () => {
    if (!path) return
    setLoading(true)
    setError(null)
    try {
      setData(await apiGet<T>(path))
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(500, String(e)))
    } finally {
      setLoading(false)
    }
  }, [path])

  useEffect(() => { void reload() }, [reload, ...deps])

  return { data, loading, error, reload, setData }
}

// oblikovanje številk/datumov (sl-SI)
export const fmtEUR = (n: number | null | undefined) =>
  new Intl.NumberFormat('sl-SI', { style: 'currency', currency: 'EUR' }).format(n ?? 0)
export const fmtDate = (d: string | Date | null | undefined) =>
  d ? new Intl.DateTimeFormat('sl-SI', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(d)) : '—'
export const fmtDateTime = (d: string | Date | null | undefined) =>
  d ? new Intl.DateTimeFormat('sl-SI', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(d)) : '—'

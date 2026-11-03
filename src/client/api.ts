// 面板调 host 管理 API：同源相对路径，简单轮询。
import { useEffect, useState } from 'react'

export async function api<T = any>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const r = await fetch('/kinstra/api' + path, {
    method: options.method ?? (options.body ? 'POST' : 'GET'),
    headers: options.body ? { 'content-type': 'application/json' } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  })
  return r.json() as Promise<T>
}

export function usePoll<T>(path: string, intervalMs = 4000): { data: T | null; error: string | null; refresh: () => void } {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let alive = true
    api<T>(path).then((d) => { if (alive) { setData(d); setError(null) } }).catch((e) => { if (alive) setError(String(e)) })
    const id = setInterval(() => {
      api<T>(path).then((d) => { if (alive) setData(d) }).catch(() => {})
    }, intervalMs)
    return () => { alive = false; clearInterval(id) }
  }, [path, intervalMs, tick])
  return { data, error, refresh: () => setTick((t) => t + 1) }
}

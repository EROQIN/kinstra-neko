// OneBot 网关健康检查：对协议端发 get_login_info，通且返回 ok 即视为在线。
// 与具体协议端（NapCat / 任意 OneBot v11 实现）解耦，故放在中立模块，
// 避免 gateway 之间互相 import。

export async function gatewayHealthy(
  ep: { httpUrl: string; httpToken: string },
  timeoutMs = 1500,
): Promise<boolean> {
  if (!ep?.httpUrl) return false
  try {
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (ep.httpToken) headers.authorization = `Bearer ${ep.httpToken}`
    const r = await fetch(`${ep.httpUrl.replace(/\/+$/, '')}/get_login_info`, {
      method: 'POST',
      headers,
      body: '{}',
      signal: AbortSignal.timeout(timeoutMs),
    })
    const j = await r.json().catch(() => null)
    return Boolean(j && (j.status === 'ok' || j.retcode === 0))
  } catch {
    return false
  }
}

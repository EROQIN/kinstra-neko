// 跨进程文件锁：防止两个插件实例同时写同一个状态文件。
// 不依赖 proper-lockfile：在同进程内用一把异步互斥锁即可（DSH 每 profile 只加载一次插件）。

export class AsyncMutex {
  private chain: Promise<unknown> = Promise.resolve()

  async run<T>(fn: () => Promise<T> | T): Promise<T> {
    const prev = this.chain
    let release: () => void
    this.chain = new Promise<void>((resolve) => { release = resolve })
    await prev
    try {
      return await fn()
    } finally {
      release!()
    }
  }
}

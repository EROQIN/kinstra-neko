// NapCat 托管：一键安装器把 NapCat 装好并生成 run-napcat 脚本；插件负责
// 生成 OneBot11 网络配置、生成访问令牌、启停脚本、健康检查。
//
// 为什么启动委托给脚本：NapCat 各版本（Shell / 桌面注入 / Xvfb）启动方式差异大，
// 安装时按当版官方文档生成 run-napcat.sh / .bat 最稳，插件不绑死任何一版启动参数。
//
// 配置文件（NapCat 4.x 约定）：
//   <installDir>/config/onebot11_<uin>.json —— 单号 OneBot11 网络配置
//   <installDir>/config/webui.json          —— WebUI 端口与 token

import { spawn, execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import type { EndpointConfig } from '../onebot/types.js'
import type { Logger } from '../core/logger.js'
import { dataDir } from '../core/store.js'
import { gatewayHealthy } from './health.js'

export interface NapCatConfigView {
  dir: string
  httpPort: number
  wsPort: number
  token: string
}

export interface NapCatManagerOptions {
  config: () => NapCatConfigView
  botQQ: () => string
  onToken: (token: string) => void
  /** NapCat 启动日志里打印出 WebUI token 时回灌（读不到 webui.json 时的兜底）。 */
  onWebUiToken?: (token: string) => void
  log: Logger
}

/** 生成 NapCat OneBot11 网络配置（httpServers + wsServers，仅 loopback）。 */
export function onebotConfigJson(uin: string, cfg: NapCatConfigView): unknown {
  return {
    network: {
      httpServers: [{
        name: 'kinstra-http', enable: true, host: '127.0.0.1', port: cfg.httpPort,
        accessToken: cfg.token, debug: false,
      }],
      httpClients: [],
      wsServers: [{
        name: 'kinstra-ws', enable: true, host: '127.0.0.1', port: cfg.wsPort,
        accessToken: cfg.token, debug: false,
      }],
      wsClients: [],
    },
    musicSignUrl: '',
    enableLocalFile2Url: true,
    parseMultMsg: false,
    // 以本号为唯一作用域
    fileLog: false,
    consoleLog: true,
    reportSelfMessage: false,
    ignoreSelf: true,
  }
}

export function createNapCatManager(opts: NapCatManagerOptions) {
  const log = opts.log
  let child: ReturnType<typeof spawn> | null = null

  function installDir(): string {
    return opts.config().dir || dataDir('napcat')
  }

  function configDir(): string {
    return join(installDir(), 'config')
  }

  function runScript(): string {
    return join(installDir(), process.platform === 'win32' ? 'run-napcat.bat' : 'run-napcat.sh')
  }

  function detect(): { installed: boolean; reason?: string; dir: string } {
    const dir = installDir()
    if (!existsSync(dir)) return { installed: false, reason: 'NapCat 还没安装（在向导里点一键安装）', dir }
    if (!existsSync(runScript())) return { installed: false, reason: `安装不完整：缺 ${runScript()}（重新跑一次安装）`, dir }
    return { installed: true, dir }
  }

  /** 写好该 QQ 号的 OneBot11 配置；没有 token 就生成一个并回存。 */
  function provision(): EndpointConfig & { found: boolean } {
    const cfg = opts.config()
    let token = cfg.token
    if (!token) {
      token = randomBytes(16).toString('base64url')
      opts.onToken(token)
    }
    const view = { ...cfg, token }
    const uin = opts.botQQ()
    if (uin) {
      mkdirSync(configDir(), { recursive: true })
      const file = join(configDir(), `onebot11_${uin}.json`)
      writeFileSync(file, JSON.stringify(onebotConfigJson(uin, view), null, 2), 'utf8')
      log.debug(`已写入 NapCat OneBot 配置：${file}`)
    }
    return {
      httpUrl: `http://127.0.0.1:${cfg.httpPort}`,
      wsUrl: `ws://127.0.0.1:${cfg.wsPort}`,
      httpToken: token,
      wsToken: token,
      found: Boolean(uin),
    }
  }

  function endpoint(): EndpointConfig {
    const cfg = opts.config()
    return {
      httpUrl: `http://127.0.0.1:${cfg.httpPort}`,
      wsUrl: `ws://127.0.0.1:${cfg.wsPort}`,
      httpToken: cfg.token,
      wsToken: cfg.token,
    }
  }

  async function healthy(): Promise<boolean> {
    return gatewayHealthy(endpoint())
  }

  async function running(): Promise<boolean> {
    if (child) return true
    return healthy()
  }

  async function start(): Promise<{ ok: boolean; message: string }> {
    const d = detect()
    if (!d.installed) return { ok: false, message: d.reason ?? '未安装' }
    if (await running()) return { ok: true, message: 'NapCat 已经在运行' }
    provision()
    const script = runScript()
    if (process.platform !== 'win32') {
      try { chmodSync(script, 0o755) } catch { /* ignore */ }
    }
    try {
      child = spawn(script, [], {
        cwd: installDir(),
        // Windows 下 NapCat 的扫码二维码打印在它自己的控制台窗口里，必须露窗；
        // Linux 走 Xvfb，无需窗口。
        windowsHide: process.platform !== 'win32',
        // POSIX 下让 run 脚本当新进程组组长：run-napcat.sh `exec xvfb-run`，其下再 fork
        // Xvfb 与 QQ(+zygote)，都继承这个 pgid。停止时对负 pid 发信号才能一次收干净整组；
        // 只 kill 直接子会留下 Xvfb/QQ 孤儿（真机实测）。Windows 靠 taskkill /T，不能 detached。
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: process.platform === 'win32',
      })
    } catch (error) {
      return { ok: false, message: `启动失败：${(error as Error).message}` }
    }
    const me = child
    me.stdout?.on('data', (b) => {
      const text = String(b)
      // 兜底抓 WebUI token：webui.json 刚生成前的窗口里，面板靠它先能换凭证。
      const m = text.match(/WebUi Token:\s*([A-Za-z0-9_\-]+)/)
      if (m && opts.onWebUiToken) { try { opts.onWebUiToken(m[1]!) } catch { /* ignore */ } }
      log.debug(text.split(/\r?\n/).filter(Boolean).slice(-3).join(' / '))
    })
    me.stderr?.on('data', (b) => log.debug(String(b).slice(0, 300)))
    me.on('exit', (code) => { if (child === me) { log.warn(`NapCat 退出（code ${code}）`); child = null } })
    log.info(`已启动 NapCat（pid ${me.pid}），首次运行需要在它的窗口里扫码登录小号`)
    return { ok: true, message: '已启动' }
  }

  /** 结束 NapCat 进程。
   *  Windows 下 spawn(.bat, shell:true) 的 pid 是 cmd.exe，只 kill 它会孤儿化
   *  NapCat/QQ，必须 taskkill /T 连整棵进程树一起结束。
   *  POSIX 下 start() 用 detached:true 建了新进程组，对负 pid 发 SIGTERM 即可连同
   *  xvfb-run → Xvfb + QQ(+zygote) 整组结束；进程组已不在（ESRCH）时兜底 kill 直接子。 */
  function killTree(me: NonNullable<typeof child>): void {
    if (process.platform === 'win32') {
      try {
        execFileSync('taskkill', ['/pid', String(me.pid), '/T', '/F'], { stdio: 'ignore' })
        return
      } catch { /* 兜底再试普通 kill */ }
    }
    if (typeof me.pid === 'number') {
      try { process.kill(-me.pid, 'SIGTERM'); return } catch { /* 组已不在，兜底直接 kill */ }
    }
    try { me.kill() } catch { /* ignore */ }
  }

  function stop(): { ok: boolean; message: string } {
    if (!child) return { ok: false, message: '不是插件启动的 NapCat（或已经停了）' }
    const me = child
    child = null
    killTree(me)
    return { ok: true, message: '已停止' }
  }

  /** 插件卸载/收尾时结束托管进程。 */
  function dispose(): void {
    if (child) { const me = child; child = null; killTree(me) }
  }

  return { detect, provision, endpoint, healthy, running, start, stop, dispose, installDir }
}

export type NapCatManager = ReturnType<typeof createNapCatManager>

/** 系统里有没有某命令（安装器自检用）。 */
export function hasCommand(cmd: string): boolean {
  try {
    execFileSync(process.platform === 'win32' ? 'where' : 'sh', process.platform === 'win32' ? [cmd] : ['-c', `command -v ${cmd}`], { stdio: 'ignore' })
    return true
  } catch { return false }
}

#!/usr/bin/env node
// Kinstra Neko 初始化器：创建独立 DSH profile、装入猫娘 bundle、引导最小配置。
// 用法：
//   pnpm dlx kinstra-neko init            # 从 npm 装插件（推荐；npm/npx 会因 alpha 严格 peer 报 ERESOLVE）
//   node kinstra-neko-init.mjs init --link /path/to/kinstra-neko   # 开发/离线本地装
//   node kinstra-neko-init.mjs doctor     # 环境自检
//   node kinstra-neko-init.mjs set-napcat-dir <NapCat Shell 目录>  # 安装器种协议端目录

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync, chmodSync, readSync, readFileSync, renameSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'

const PROFILE = 'kinstra-neko'
const PKG = 'kinstra-neko'
const MIN_NODE = [22, 19]
const isWin = process.platform === 'win32'

const c = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  pink: '\x1b[35m', cyan: '\x1b[36m', green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m',
}
const say = (msg) => console.log(`${c.pink}🐾 ${c.reset}${msg}`)
const ok = (msg) => console.log(`${c.green}  ✓ ${c.reset}${msg}`)
const warn = (msg) => console.log(`${c.yellow}  ! ${c.reset}${msg}`)
const fail = (msg) => console.log(`${c.red}  ✗ ${c.reset}${msg}`)

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: opts.silent ? 'pipe' : 'inherit', encoding: 'utf8', shell: isWin })
  if (r.status !== 0 && opts.required !== false) {
    throw new Error(`${cmd} ${args.join(' ')} 失败（${r.status}）\n${r.stderr ?? r.stdout ?? ''}`)
  }
  return r
}

function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}
function profileDir() { return join(dshHome(), 'profiles', PROFILE) }
// 与插件 src/core/store.ts 的 dataDir() 保持一致（同受 KINSTRA_NEKO_DATA_DIR 覆盖）。
function dataDir(...parts) {
  const base = process.env.KINSTRA_NEKO_DATA_DIR || join(dshHome(), 'plugins-data', 'kinstra-neko')
  return join(base, ...parts)
}

function nodeOk() {
  const m = process.versions.node.split('.').map(Number)
  return (m[0] ?? 0) > MIN_NODE[0] || ((m[0] ?? 0) === MIN_NODE[0] && (m[1] ?? 0) >= MIN_NODE[1])
}

function dshAvailable() {
  const r = run(isWin ? 'dsh.cmd' : 'dsh', ['--version'], { silent: true, required: false })
  return r.status === 0 ? String(r.stdout ?? '').trim() : ''
}

function ask(q, def = '') {
  const buf = Buffer.alloc(1024)
  process.stdout.write(`${c.cyan}  ? ${c.reset}${q}${def ? ` ${c.dim}[${def}]${c.reset}` : ''}: `)
  const n = readSync(0, buf, 0, buf.length, null)
  const v = Buffer.from(buf.subarray(0, n)).toString('utf8').trim()
  return v || def
}

function banner() {
  console.log(`\n${c.pink}${c.bold}  Kinstra Neko 初始化${c.reset}\n  住在 QQ 群里的猫娘 · ${c.dim}基于 DeepSeek Harness${c.reset}\n`)
}

function cmdDoctor() {
  banner()
  let good = true
  const nodeVer = process.versions.node
  if (nodeOk()) ok(`Node.js ${nodeVer}`)
  else { fail(`Node.js ${nodeVer}，需要 ≥ ${MIN_NODE.join('.')}（用安装脚本或 nvm 升级）`); good = false }

  const dshVer = dshAvailable()
  if (dshVer) ok(`DeepSeek Harness ${dshVer}`)
  else { warn('未检测到 dsh（npm i -g @deepseek-ai/dsh，或先跑平台安装脚本）'); good = false }

  const pdir = profileDir()
  if (existsSync(pdir)) ok(`profile 已存在：${pdir}`)
  else warn(`profile 尚未创建：${pdir}`)

  console.log()
  if (!good) { say('先处理上面的问题，再跑 init。'); process.exitCode = 1 }
}

// 安装器在装好官方 NapCat 一键包、拿到真实 Shell 目录后调用：
// 把该目录幂等地写进插件 config.json 的 napcat.dir，并把 gateway 固定为 napcat。
// 可独立重复运行；插件尚未首次启动（config.json 不存在）也能用——缺的字段插件启动时按默认补齐。
function cmdSetNapcatDir(dirArg) {
  const dir = (dirArg || process.env.KINSTRA_NEKO_NAPCAT_DIR || '').trim()
  if (!dir) { fail('用法：kinstra-neko set-napcat-dir <NapCat Shell 目录>（或设 KINSTRA_NEKO_NAPCAT_DIR）'); process.exit(1) }
  if (!existsSync(dir)) { fail(`目录不存在：${dir}`); process.exit(1) }

  const file = dataDir('config.json')
  let cfg = {}
  try { cfg = JSON.parse(readFileSync(file, 'utf8')) } catch { cfg = {} }
  cfg.gateway = 'napcat'
  cfg.napcat = { ...(cfg.napcat && typeof cfg.napcat === 'object' ? cfg.napcat : {}), dir }

  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}`
  writeFileSync(tmp, JSON.stringify(cfg, null, 2), 'utf8')
  renameSync(tmp, file)
  ok(`已把 NapCat 目录写入配置：${dir}`)
  ok(`配置文件：${file}`)
}

function cmdInit(options) {
  banner()
  if (!nodeOk()) { fail(`Node 版本太低（${process.versions.node}），需要 ≥ ${MIN_NODE.join('.')}`); process.exit(1) }

  let dshVer = dshAvailable()
  if (!dshVer) {
    say('没找到 dsh 命令。')
    const version = process.env.DSH_VERSION || '0.2.1-rc.3'
    const cont = ask(`回车用 npm 全局安装 @deepseek-ai/dsh@${version}（需要联网，约 1-2 分钟），输 n 取消`, 'y')
    if (cont.toLowerCase() === 'n') { fail('已取消。装好 dsh 后再跑一次。'); process.exit(1) }
    say('安装 DSH …')
    run('npm', ['install', '-g', `@deepseek-ai/dsh@${version}`, '--no-audit', '--no-fund'])
    dshVer = dshAvailable()
    if (!dshVer) { fail('dsh 安装后仍不可用，检查 npm 全局 bin 是否在 PATH 里'); process.exit(1) }
  }
  ok(`DeepSeek Harness ${dshVer}`)

  // 1) 建 profile（从 web 模板）
  const pdir = profileDir()
  if (!existsSync(pdir)) {
    say(`创建独立 profile「${PROFILE}」…`)
    run('dsh', [PROFILE, '--from-default-profile', 'web', '--dump-config'])
    ok(`profile：${pdir}`)
  } else {
    ok(`profile 已存在：${pdir}（保留现有配置）`)
  }

  // 2) 装 bundle
  const spec = options.link ? `link:${options.link}` : (process.env.KINSTRA_NEKO_SPEC || PKG)
  say(`装入 Kinstra Neko 插件（${spec}）…`)
  run('dsh', ['plugin', '--profile', PROFILE, 'add', spec])
  ok('插件已安装并启用')

  // 3) 可选：写 API key 到凭据文件
  const home = dshHome()
  const credFile = join(home, '.credentials.yaml')
  if (!existsSync(credFile)) {
    const key = ask('模型 API Key（可先跳过，稍后在网页面板填；DeepSeek/OpenAI 兼容均可）', '')
    if (key) {
      mkdirSync(home, { recursive: true })
      writeFileSync(credFile, `# Kinstra Neko 模型凭据（0600 权限建议自行设置）\nDEEPSEEK_API_KEY: ${key}\n`, { mode: 0o600 })
      try { chmodSync(credFile, 0o600) } catch { /* Windows 忽略 */ }
      ok(`已写入 ${credFile}`)
    }
  }

  // 4) 启动提示
  const port = process.env.KINSTRA_NEKO_PORT || '3090'
  console.log()
  say('初始化完成！接下来：')
  console.log(`  1. 确保 QQ 协议端在跑（NapCat：先执行平台安装脚本；或自行准备 OneBot v11）`)
  console.log(`  2. 启动控制台：  ${c.bold}dsh --profile ${PROFILE} web --port ${port}${c.reset}`)
  console.log(`  3. 浏览器打开 http://127.0.0.1:${port} ，按猫娘向导填小号 QQ、你的 QQ、白名单`)
  console.log(`     默认是试运行：她只会在面板记录“本来会说什么”，确认对味后再关试运行\n`)
}

// —— 入口 ——
const [,, command, ...rest] = process.argv
if (command === 'doctor') {
  cmdDoctor()
} else if (command === 'set-napcat-dir') {
  cmdSetNapcatDir(rest[0])
} else {
  const options = { link: undefined }
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--link') options.link = rest[++i]
  }
  cmdInit(options)
}

# Kinstra Neko · Windows 一键安装（PowerShell）
# 用法（管理员或普通用户均可，Node 装到用户目录不需要管理员）：
#   irm https://raw.githubusercontent.com/EROQIN/kinstra-neko/main/installer/windows/install.ps1 | iex
# 或：powershell -ExecutionPolicy Bypass -File install.ps1
#
# 做的事：Node 22（winget/缺失时引导）→ 全局 DSH → kinstra-neko init →
# 引导安装 NapCat（Windows 用 NapCat.QQNT 安装包或 SnowLuma）→ 生成 start-kinstra.bat

$ErrorActionPreference = 'Stop'
$ProfileName = 'kinstra-neko'
$DshVersion = if ($env:DSH_VERSION) { $env:DSH_VERSION } else { '0.2.1-rc.3' }
$WebPort = if ($env:WEB_PORT) { $env:WEB_PORT } else { '3090' }

function Say($m) { Write-Host "🐾 $m" -ForegroundColor Magenta }
function Ok($m)  { Write-Host "  ✓ $m" -ForegroundColor Green }
function Warn($m){ Write-Host "  ! $m" -ForegroundColor Yellow }
function Die($m) { Write-Host "  ✗ $m" -ForegroundColor Red; exit 1 }

Write-Host "`n  Kinstra Neko · Windows 一键安装`n" -ForegroundColor Magenta

# 1. Node
$nodeOk = $false
try {
  $nv = [version]((node -v) -replace '^v', '')
  if ($nv -ge [version]'22.19.0') { $nodeOk = $true; Ok "Node.js $($nv.ToString())" }
} catch {}

if (-not $nodeOk) {
  Say '安装 Node.js 22…'
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    winget install OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
    $env:Path = [System.Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path', 'User')
  } else {
    Die '没找到 winget。请先安装 Node.js 22+：https://nodejs.org/ ，然后重跑本脚本。'
  }
}

# 2. DSH
try { dsh --version | Out-Null; Ok "DSH $(dsh --version)" } catch {
  Say "全局安装 DeepSeek Harness @$DshVersion …"
  npm install -g "@deepseek-ai/dsh@$DshVersion" --no-audit --no-fund
}

# 3. 插件初始化
Say '初始化 Kinstra Neko …'
$initArgs = @('init')
if ($env:KINSTRA_NEKO_SPEC) { $initArgs = @('init', '--link', $env:KINSTRA_NEKO_SPEC) }
$env:DSH_VERSION = $DshVersion
npx -y kinstra-neko@latest @initArgs
if ($LASTEXITCODE -ne 0) { Die '插件初始化失败，检查网络后重试（开发版设 KINSTRA_NEKO_SPEC=本地目录）。' }
Ok '猫娘插件已装入 profile'

# 4. 协议端引导（Windows 推荐 SnowLuma，也可用 NapCat）
$appData = Join-Path $env:USERPROFILE '.kinstra-neko'
New-Item -ItemType Directory -Force -Path $appData | Out-Null
$startBat = Join-Path $appData 'start-kinstra.bat'
@"
@echo off
REM Kinstra Neko 启动脚本（安装器生成）
title Kinstra Neko
echo Starting Kinstra Neko on http://127.0.0.1:$WebPort ...
start "" http://127.0.0.1:$WebPort
dsh --profile $ProfileName web --port $WebPort
pause
"@ | Set-Content -Encoding UTF8 $startBat
Ok "启动脚本：$startBat（已在桌面放快捷方式）"

try {
  $desktop = [Environment]::GetFolderPath('Desktop')
  $ws = New-Object -ComObject WScript.Shell
  $sc = $ws.CreateShortcut((Join-Path $desktop 'Kinstra Neko.lnk'))
  $sc.TargetPath = $startBat
  $sc.WorkingDirectory = $appData
  $sc.Save()
} catch {}

Write-Host ''
Say '安装完成！接下来（QQ 协议端二选一）：'
@"

  方式 A · SnowLuma（推荐，Win 体验最好）
    1. 自行下载解压：https://github.com/SnowLuma/SnowLuma/releases/latest
       （其协议要求你本人下载并同意条款，安装器不会代下代签）
    2. 打开 http://127.0.0.1:3090 → Kinstra Neko → 连接
       接入方式选 SnowLuma，填解压目录与控制台密码，点「接入机器人号」

  方式 B · NapCat / 任意 OneBot v11
    装好 NapCat 并扫码登录小号后，在连接页选「任意 OneBot v11 地址」，
    填 HTTP/WS 地址与令牌。

  然后：双击桌面「Kinstra Neko」→ 按向导填两个 QQ 号 → 配模型 API Key
  → 加群白名单 → 试运行确认 → 关试运行开麦。

  ⚠ 非官方 QQ 接入有账号风险，请务必使用小号。
"@ | Write-Host

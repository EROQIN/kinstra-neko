# Kinstra Neko · Windows 一键安装（PowerShell）
# 用法（管理员或普通用户均可，Node 装到用户目录不需要管理员）：
#   irm https://raw.githubusercontent.com/EROQIN/kinstra-neko/main/installer/windows/install.ps1 | iex
# 或：powershell -ExecutionPolicy Bypass -File install.ps1
#
# 做的事：Node 22（winget/缺失时引导）→ 全局 DSH → kinstra-neko init →
# 自动下载并运行 NapCat 官方一键包（NapCatInstaller.exe 自动部署 QQ+NapCat，无需预装 QQ）
# → 生成 run-napcat.bat 薄壳并把 Shell 目录种入插件配置 → 生成 start-kinstra.bat
#
# 可覆盖变量：DSH_VERSION、WEB_PORT（默认 3090）、KINSTRA_NEKO_SPEC（开发/离线本地源）、
#             NAPCAT_ONEKEY_URL（覆盖一键包地址）、KINSTRA_NEKO_NAPCAT_DIR（跳过下载直接指定已有目录）、
#             SKIP_NAPCAT=1（跳过协议端安装）、CN_MIRROR=1（国内网络提示）

$ErrorActionPreference = 'Stop'
$ProfileName = 'kinstra-neko'
$DshVersion = if ($env:DSH_VERSION) { $env:DSH_VERSION } else { '0.2.1-rc.3' }
$WebPort = if ($env:WEB_PORT) { $env:WEB_PORT } else { '3090' }
$NapCatOneKeyUrl = if ($env:NAPCAT_ONEKEY_URL) { $env:NAPCAT_ONEKEY_URL } else {
  'https://github.com/NapNeko/NapCatQQ/releases/latest/download/NapCat.Shell.Windows.OneKey.zip'
}

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

# 调用本包 CLI（npm 源或本地 --link 源），用于把探测到的 NapCat 目录种入插件配置。
function Invoke-KinstraCli([string[]]$CliArgs) {
  if ($env:KINSTRA_NEKO_SPEC) {
    $scriptPath = Join-Path $env:KINSTRA_NEKO_SPEC 'installer\bin\kinstra-neko-init.mjs'
    node $scriptPath @CliArgs
  } else {
    npx -y kinstra-neko@latest @CliArgs
  }
}

# 在若干常见落点浅层查找 NapCat Shell（含 napcat.bat 且同级有 config 目录）。
function Find-NapCatShell([string[]]$Roots) {
  foreach ($r in ($Roots | Where-Object { $_ } | Select-Object -Unique)) {
    if (-not (Test-Path $r)) { continue }
    try {
      $bat = Get-ChildItem -Path $r -Recurse -Depth 3 -Filter 'napcat.bat' -ErrorAction SilentlyContinue |
        Where-Object { Test-Path (Join-Path $_.DirectoryName 'config') -ErrorAction SilentlyContinue } |
        Select-Object -First 1
      if ($bat) { return $bat.DirectoryName }
    } catch {}
  }
  return $null
}

# 4. NapCat（官方一键包，自动部署 QQ + NapCat；这一步失败不阻断后续启动脚本生成）
function Install-NapCat {
  if ($env:SKIP_NAPCAT -eq '1') { Warn '已设 SKIP_NAPCAT=1，跳过 NapCat 自动安装。'; return }
  if ($env:CN_MIRROR -eq '1') { Warn '国内网络：NapCat 一键包从 GitHub 拉取，偏慢可用 NAPCAT_ONEKEY_URL 指定镜像地址。' }

  $knHome   = Join-Path $env:USERPROFILE '.kinstra-neko'
  $cacheDir = Join-Path $knHome 'cache'
  $anchor   = Join-Path $knHome 'napcat'
  $marker   = Join-Path $anchor 'napcat-home.txt'
  New-Item -ItemType Directory -Force -Path $cacheDir | Out-Null
  New-Item -ItemType Directory -Force -Path $anchor  | Out-Null

  # 4.1 幂等：已有 NapCat Shell 就直接补薄壳、种配置后返回
  $shellDir = $null
  if ($env:KINSTRA_NEKO_NAPCAT_DIR) { $shellDir = $env:KINSTRA_NEKO_NAPCAT_DIR }
  elseif (Test-Path $marker) {
    $marked = (Get-Content $marker -Raw -ErrorAction SilentlyContinue).Trim()
    if ($marked -and (Test-Path (Join-Path $marked 'napcat.bat'))) { $shellDir = $marked }
  }
  if (-not $shellDir) {
    $shellDir = Find-NapCatShell @($anchor, (Join-Path $env:USERPROFILE 'NapCat'), 'C:\NapCat')
  }

  # 4.2 没装过：下载并运行官方一键包
  if (-not $shellDir) {
    $zip = Join-Path $cacheDir 'NapCat.Shell.Windows.OneKey.zip'
    if (-not ((Test-Path $zip) -and (Get-Item $zip).Length -gt 1MB)) {
      Say '下载 NapCat 官方一键包（约上百 MB，含 QQ，耐心等等）…'
      & curl.exe -L --retry 3 -o "$zip" "$NapCatOneKeyUrl"
      if ($LASTEXITCODE -ne 0 -or -not ((Test-Path $zip) -and (Get-Item $zip).Length -gt 1MB)) {
        Warn 'NapCat 一键包下载失败（网络？）。可设 NAPCAT_ONEKEY_URL 或之后重跑本脚本，不影响先启动控制台。'
        return
      }
    }
    Ok '一键包已下载'

    $extract = Join-Path $cacheDir 'onekey'
    try {
      Expand-Archive -Path $zip -DestinationPath $extract -Force
      $exe = Get-ChildItem -Path $extract -Recurse -Filter 'NapCatInstaller.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
      if (-not $exe) { Warn '解压后没找到 NapCatInstaller.exe，资产可能改版了，跳过自动安装。'; return }
      Say '即将弹出 NapCat 官方安装器：在窗口里点「安装/完成」，它会自动装好 QQ 和 NapCat（无需预装 QQ）。'
      $proc = Start-Process -FilePath $exe.FullName -WorkingDirectory $exe.DirectoryName -PassThru -Wait
      Say "官方安装器已退出（code $($proc.ExitCode)），正在定位 NapCat Shell …"
    } catch {
      Warn "运行官方安装器时出错：$($_.Exception.Message)。可手动跑缓存目录里的 NapCatInstaller.exe。"
      return
    }

    # 官方 GUI 装完才会出现 napcat.bat：立刻扫一次，没扫到再轻量轮询几分钟
    $heavyRoots = @($extract, $anchor, (Join-Path $env:USERPROFILE 'NapCat'), 'C:\NapCat', $env:LOCALAPPDATA, $env:ProgramFiles, ${env:ProgramFiles(x86)})
    $shellDir = Find-NapCatShell $heavyRoots
    if (-not $shellDir) {
      $deadline = (Get-Date).AddMinutes(5)
      while ((Get-Date) -lt $deadline -and -not $shellDir) {
        Start-Sleep -Seconds 5
        $shellDir = Find-NapCatShell @($extract, $anchor, (Join-Path $env:USERPROFILE 'NapCat'), 'C:\NapCat')
      }
    }
    if (-not $shellDir) {
      Warn '没自动定位到 NapCat Shell 目录。装好后可在控制台「连接」页手填安装目录，或设 KINSTRA_NEKO_NAPCAT_DIR 重跑。'
      return
    }
  }

  # 4.3 在 Shell 目录生成插件约定的 run-napcat.bat 薄壳（cwd 锁在 Shell 目录，配置才能对上）
  try {
    New-Item -ItemType Directory -Force -Path (Join-Path $shellDir 'config') | Out-Null
    $runBat = Join-Path $shellDir 'run-napcat.bat'
    $body = "@echo off`r`ncd /d `"%~dp0`"`r`ncall napcat.bat`r`n"
    [System.IO.File]::WriteAllText($runBat, $body, (New-Object System.Text.UTF8Encoding($false)))
    Set-Content -Path $marker -Value $shellDir -Encoding ASCII
    Ok "NapCat Shell：$shellDir"
  } catch {
    Warn "写 run-napcat.bat 失败：$($_.Exception.Message)"
    return
  }

  # 4.4 把目录种入插件配置（gateway=napcat；缺字段插件启动时补默认）
  Invoke-KinstraCli @('set-napcat-dir', $shellDir)
  if ($LASTEXITCODE -ne 0) { Warn '写入插件配置失败，可稍后在控制台「连接」页手填 NapCat 安装目录。' }
  else { Ok '插件已记住 NapCat 安装目录' }
}

Install-NapCat

# 5. 生成 Kinstra Neko 启动脚本与桌面快捷方式
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
Say '安装完成！接下来：'
@"

  1. 双击桌面「Kinstra Neko」，浏览器会打开 http://127.0.0.1:$WebPort
  2. 按猫娘向导填「猫娘小号 QQ」和「你的 QQ」，保存
  3. 在「连接」页点「生成 OneBot 配置」，再点「启动 NapCat」
     —— 首次会弹出 NapCat 控制台窗口，用猫娘小号扫窗口里的二维码登录
     （也可打开 NapCat 自带 WebUI 看码；面板会自动核对登录的是不是你填的小号）
  4. 在 DSH 设置里配置模型服务商与 API Key
  5. 把要养她的群加进白名单
  6. 出厂是试运行：先在「试运行」页确认她会说什么，再关试运行开麦

  NapCat 已由安装器自动装好（无需自己去下载）。若上面跳过了自动安装，
  可重跑本脚本，或手动装 NapCat 后在「连接」页填安装目录。

  ⚠ 非官方 QQ 接入有账号风险，请务必使用小号。
"@ | Write-Host

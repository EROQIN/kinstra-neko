#!/usr/bin/env bash
# Kinstra Neko · Linux 一键安装（Ubuntu/Debian 系；无 Docker，适配 2H2G 云服务器）
#
# 做的事：
#   1. 环境自检 + 2G swap（内存 <2G 时自动加，防 npm/QQ OOM）
#   2. Node.js 22（缺失时用 NodeSource；国内可用 CN_MIRROR=1 走镜像）
#   3. 全局安装 DeepSeek Harness
#   4. 调 kinstra-neko init 建 profile、装猫娘 bundle
#   5. 装 NapCat（官方 NapCat-Installer；无桌面环境自动配 Xvfb+x11vnc 扫码）并生成 OneBot 配置
#   6. 注册 systemd 服务 kinstra-neko（开机自启、崩溃重启、Node 内存上限）
#
# 用法：
#   curl -fsSL https://raw.githubusercontent.com/EROQIN/kinstra-neko/main/installer/linux/install.sh | sudo bash
#   # 或下载后：sudo CN_MIRROR=1 bash install.sh
#
# 可覆盖变量：DSH_VERSION、KINSTRA_NEKO_SPEC（本地/自定义插件源）、WEB_PORT（默认 3090）、
#             WEB_HOST（默认主网卡 IP 供远程访问；设 127.0.0.1 只本机）、
#             NAPCAT_INSTALL_URL、SKIP_NAPCAT=1

set -euo pipefail

WEB_PORT="${WEB_PORT:-3090}"
# 远程（云服务器）浏览器访问需绑到网卡上的具体 IP（DSH 拒绝 0.0.0.0 通配）。
# 默认取主网卡首个 IPv4；只想本机访问可 WEB_HOST=127.0.0.1。
WEB_HOST="${WEB_HOST:-$(hostname -I 2>/dev/null | awk '{print $1}')}"
DSH_VERSION="${DSH_VERSION:-0.2.1-rc.3}"
NAPCAT_INSTALL_URL="${NAPCAT_INSTALL_URL:-https://nclatest.znin.net/NapNeko/NapCat-Installer/main/script/install.sh}"
RUN_USER="${SUDO_USER:-$USER}"
RUN_HOME="$(eval echo "~$RUN_USER")"

# 颜色
P='\033[35m'; G='\033[32m'; Y='\033[33m'; R='\033[31m'; B='\033[1m'; D='\033[2m'; N='\033[0m'
say()  { echo -e "${P}🐾 ${N}$*"; }
ok()   { echo -e "${G}  ✓ ${N}$*"; }
warn() { echo -e "${Y}  ! ${N}$*"; }
die()  { echo -e "${R}  ✗ $*${N}" >&2; exit 1; }

trap 'die "安装中断（第 $LINENO 行附近）。修正问题后重跑本脚本即可，步骤幂等。"' ERR

[ "$(id -u)" = "0" ] || die "请用 root 运行：sudo bash $0"
[ -n "$RUN_USER" ] || die "识别不到运行用户（不要直接用 root 的裸环境，建议用普通用户 sudo）"

echo -e "${B}\n  Kinstra Neko · Linux 一键安装${N}\n"

# ---------- 1. 环境 ----------
say "检查环境…"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates xz-utils jq >/dev/null 2>&1 || warn '部分基础包安装跳过'

MEM_KB="$(awk '/MemTotal/{print $2}' /proc/meminfo)"
MEM_MB=$((MEM_KB / 1024))
if [ "$MEM_MB" -lt 2000 ] && ! swapon --show | grep -q .; then
  say "内存 ${MEM_MB}MB 且无 swap，创建 2GB swap 防 OOM…"
  if [ ! -f /swapfile ]; then
    fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
    chmod 600 /swapfile
    mkswap /swapfile >/dev/null
    swapon /swapfile
  fi
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  sysctl -w vm.swappiness=10 >/dev/null
  grep -q 'vm.swappiness' /etc/sysctl.conf || echo 'vm.swappiness=10' >> /etc/sysctl.conf
  ok 'swap 已启用'
else
  if swapon --show | grep -q .; then ok "内存 ${MEM_MB}MB，swap 已有"; else ok "内存 ${MEM_MB}MB，无需 swap"; fi
fi

# ---------- 2. Node ----------
need_node=1
if command -v node >/dev/null 2>&1; then
  NV="$(node -v | sed 's/v//')"
  MAJOR="${NV%%.*}"
  if [ "$MAJOR" -ge 22 ]; then need_node=0; ok "Node.js $NV"; fi
fi
if [ "$need_node" = 1 ]; then
  say '安装 Node.js 22…'
  if [ "${CN_MIRROR:-0}" = 1 ]; then
    curl -fsSL https://npmmirror.com/mirrors/node/v22.20.0/node-v22.20.0-linux-$(dpkg --print-architecture).tar.xz -o /tmp/node.tar.xz
    tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1
    npm config set registry https://registry.npmmirror.com
  else
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
    apt-get install -y -qq nodejs >/dev/null
  fi
  ok "Node.js $(node -v)"
fi

# ---------- 3. DSH ----------
# 系统级 node（NodeSource）的全局 prefix 是 /usr，/usr/lib/node_modules 归 root，
# 因此全局包必须以 root 身份装（bin 链到 /usr/bin/dsh，普通用户也能调用）。
# 切勿 su 到普通用户执行 npm -g：写不进 root 目录会 EACCES。
if ! command -v dsh >/dev/null 2>&1; then
  say "全局安装 DeepSeek Harness @$DSH_VERSION…"
  npm install -g "@deepseek-ai/dsh@$DSH_VERSION" --no-audit --no-fund
fi
ok "DSH：$(dsh --version 2>/dev/null || echo 已安装)"

# pnpm：DSH 的 `dsh plugin add` 用 pnpm 装插件，且本生态全是 alpha 预发布版本，
# npm 的严格 peer 解析会因版本范围（精确 alpha vs ~x.y.z）报 ERESOLVE，pnpm 只告警不阻断。
if ! command -v pnpm >/dev/null 2>&1; then
  say '安装 pnpm（DSH 插件管理器依赖）…'
  npm install -g pnpm --no-audit --no-fund
fi
ok "pnpm $(pnpm -v)"

# ---------- 4. Kinstra Neko 插件 ----------
say '初始化 Kinstra Neko profile 与插件…'
INIT_ARGS='init'
[ -n "${KINSTRA_NEKO_SPEC:-}" ] && INIT_ARGS="init --link $KINSTRA_NEKO_SPEC"
# 用 pnpm dlx 而非 npx：同上，避开 npm 严格 peer 对 alpha 版本的 ERESOLVE。
# curl|bash 时 stdin 是脚本管道，真实交互要读键盘得用 /dev/tty；但无控制终端
# （非交互 ssh、部分 sudo）下 /dev/tty 打不开会直接报错，故探测后回退 /dev/null
# （init 唯一交互是可跳过的 API Key，EOF 即取默认空值）。
if ( true </dev/tty ) 2>/dev/null; then TTYIN=/dev/tty; else TTYIN=/dev/null; fi
su - "$RUN_USER" -c "DSH_VERSION=$DSH_VERSION pnpm dlx kinstra-neko@latest $INIT_ARGS < $TTYIN" || \
  die '插件初始化失败（网络问题可重试；开发版可设 KINSTRA_NEKO_SPEC=本地目录）'
ok '猫娘插件已装入 profile'

# ---------- 5. NapCat（可跳过）----------
if [ "${SKIP_NAPCAT:-0}" != 1 ]; then
  say '安装 NapCat（官方安装器；无桌面环境会配 Xvfb + x11vnc 供扫码）…'
  if [ "${CN_MIRROR:-0}" = 1 ]; then
    warn '国内镜像模式：NapCat 官方脚本从 GitHub 拉取，如缓慢可稍后手动执行其安装指引'
  fi
  curl -fsSL "$NAPCAT_INSTALL_URL" -o /tmp/napcat-install.sh
  # 官方脚本通常支持 sudo bash napcat.sh；交互项尽量走默认（它会处理 QQ/Xvfb/systemd）
  bash /tmp/napcat-install.sh || warn 'NapCat 安装器返回非零（版本差异）。可稍后手动安装，或在面板「连接」里改接任意 OneBot。'

  NAPCAT_DIR="${NAPCAT_DIR:-$RUN_HOME/napcat}"
  say "在 $NAPCAT_DIR 准备 OneBot 配置（首次扫码登录小号后，由面板自动写入正式 onebot11_<QQ>.json）…"
  install -d -o "$RUN_USER" -g "$RUN_USER" "$NAPCAT_DIR/config"
  cat > "$NAPCAT_DIR/run-napcat.sh" <<'RUNEOF'
#!/usr/bin/env bash
# Kinstra Neko 调起的 NapCat 启动脚本（由安装器生成；如官方安装器的服务名不同，
# 本脚本作为兜底：优先用 systemd 服务，否则提示手动启动）。
set -e
if systemctl list-unit-files | grep -q napcat; then
  sudo systemctl start napcat
else
  echo "未发现 napcat systemd 服务，请用 NapCat 官方方式启动（如 sudo napcat）" >&2
  exit 1
fi
RUNEOF
  chmod +x "$NAPCAT_DIR/run-napcat.sh"
  chown -R "$RUN_USER":"$RUN_USER" "$NAPCAT_DIR"
  ok 'NapCat 安装/引导完成（首次需扫码登录小号，见 NapCat 官方输出或面板连接页）'
fi

# ---------- 6. systemd 服务 ----------
say '注册 systemd 服务 kinstra-neko…'
NODE_BIN="$(su - "$RUN_USER" -c 'command -v node')"
DSH_BIN="$(su - "$RUN_USER" -c 'command -v dsh')"
# --host 只接受具体本机 IP（拒绝通配）；取不到就不传给 DSH（回落其默认 loopback）。
BIND_ARGS="--port $WEB_PORT --no-open"
[ -n "$WEB_HOST" ] && BIND_ARGS="--host $WEB_HOST $BIND_ARGS"
cat > /etc/systemd/system/kinstra-neko.service <<SVCEOF
[Unit]
Description=Kinstra Neko — DSH web with QQ catgirl
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$RUN_USER
Environment=NODE_ENV=production
# 2H2G 内存上限：给 NapCat/系统留足，DSH 侧压缩到 ~700MB 老生代
Environment=NODE_OPTIONS=--max-old-space-size=700
ExecStart=$DSH_BIN --profile kinstra-neko $BIND_ARGS
Restart=on-failure
RestartSec=5
WorkingDirectory=$RUN_HOME

[Install]
WantedBy=multi-user.target
SVCEOF

systemctl daemon-reload
systemctl enable kinstra-neko >/dev/null 2>&1
systemctl restart kinstra-neko
ok '服务已启动并设为开机自启'

# web 首次挂载插件要十几秒，等到 active 且端口起来（最多 ~40s）
BIND_IP="${WEB_HOST:-127.0.0.1}"
for _ in $(seq 1 20); do
  systemctl is-active --quiet kinstra-neko || { warn '服务没起来：journalctl -u kinstra-neko -n 50 看日志'; break; }
  curl -s -o /dev/null --max-time 2 "http://$BIND_IP:$WEB_PORT/" && break
  sleep 2
done
systemctl is-active --quiet kinstra-neko && ok "kinstra-neko 正在运行（监听 $BIND_IP:$WEB_PORT）"

# DSH web 默认带一次性 token 门，从日志取带 token 的直达 URL
TOKEN_URL="$(journalctl -u kinstra-neko --no-pager 2>/dev/null | grep -oE 'http://[^ ]*\?token=[^ ]+' | tail -1)"
if [ -n "$TOKEN_URL" ]; then
  TOKEN_URL="${TOKEN_URL/127.0.0.1/$BIND_IP}"
  TOKEN_URL="${TOKEN_URL/localhost/$BIND_IP}"
else
  TOKEN_URL="http://$BIND_IP:$WEB_PORT/（按页面提示取 token：journalctl -u kinstra-neko -n 30）"
fi

echo
say '安装完成！'
cat <<TIPS

  控制台（带免输 token 的直达地址）：
    $TOKEN_URL
  （也可运行： journalctl -u kinstra-neko -n 30 | grep -o 'http://.*token=.*' | tail -1）
  云服务器：确认安全组/防火墙放行 $WEB_PORT/tcp；只想本机访问用 WEB_HOST=127.0.0.1 重装。
  服务管理：  sudo systemctl {status|restart|stop} kinstra-neko
  实时日志：  journalctl -u kinstra-neko -f

  上线步骤：
  1. 控制台按猫娘向导填「猫娘小号 QQ」和「你的 QQ」
  2. 扫码登录 NapCat 里的小号（无桌面服务器走 x11vnc，见 NapCat 安装输出）
  3. 在 DSH 设置里配置模型服务商与 API Key
  4. 把要养她的群加进白名单
  5. 出厂是试运行：先在「试运行」页确认她会说什么，再关试运行开麦

  ⚠ 非官方 QQ 接入有账号风险，请务必使用小号。
TIPS

# 白标 Web 构建（可选）

只装本插件时，DSH 侧栏与面板已经是 Kinstra Neko 品牌（插件占住了
`sidebar.brand.*` 等插槽）。浏览器标签标题、favicon、PWA 名字属于**构建期**资产，
插件改不了；要连这些也换掉，需要自构建一次 DSH 的 `apps/web`。

## 为什么需要这一步

DSH 官方品牌（DeepSeek logo/名称）本身是一个独立 client 插件，只在
`DSH_CLIENT_BUILD_PROFILE=official` 时注册。非官方构建天然不加载它——我们再占住
品牌插槽即可，所以 **372 个内核包一行都不用改**。

## 步骤

```bash
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
pnpm install   # 要求 pnpm；Node 22.19+

# 1) 替换 web 静态资产
cp /path/to/kinstra-neko/assets/favicon.svg        apps/web/public/favicon.svg
cp /path/to/kinstra-neko/assets/favicon.svg        apps/web/public/favicon-dark.svg
cp /path/to/kinstra-neko/assets/manifest.webmanifest apps/web/public/manifest.webmanifest
# icon-192.png / icon-512.png / apple-touch-icon.png 建议另出位图（SVG 转 PNG）：
#   任意工具把 assets/logo.svg 导出 192/512 PNG 即可

# 2) 关键：不要设 official profile；设置自定义标题
export DSH_CLIENT_TITLE="Kinstra Neko"
unset DSH_CLIENT_BUILD_PROFILE

# 3) 构建 web app（参考根仓库 Makefile / package.json 的 web 构建脚本）
pnpm build:web
# 产物在 apps/web 的构建输出；DSH host 通过 @deepseek-ai/dsh-host-frontend-static 提供
```

构建后把这份自构建的 frontend 用于你的发行（替换/覆盖
`@deepseek-ai/dsh-host-frontend-static` 的静态目录，或按上游文档指定静态路径）。

## 主题色

DSH 主题由 `packages/client/ui-theme` 的 CSS 变量（`--dsw-*`）统一管理，
没有运行时换肤机制。要换品牌色（默认 Kinstra 粉 `#ff7eb3`）：

- 轻量做法（推荐）：不改构建。本插件面板与侧栏品牌组件已内联使用品牌粉，
  在 DSH 宿主主题之上显示，侵入为零。
- 深度做法：fork `ui-theme` 调语义色板后随自构建一起发布。

## 桌面端（二期）

Electron 壳 `apps/desktop` 与 DSH 账号体系耦合较深，本期不白标桌面端。
需要时改 `apps/desktop/scripts/electron-builder-config.mjs` 的
`productName / appId / 协议 scheme / 图标` 与 `apps/desktop/resources/*`，
共 6-8 处，然后 `pnpm package:desktop:win:x64`。

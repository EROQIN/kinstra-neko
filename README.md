# Kinstra Neko 🐾

**住在你 QQ 群里的猫娘。** 一个自部署的社交陪伴机器人：被 @ 会回，没人叫时按话题相关度自然插话，记得群友的小事，有自己的性格。

基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）二次开发，通过 OneBot v11 接入 QQ。面向普通用户：一条命令装完，浏览器里图形化配置，出厂默认低打扰 + 试运行保护。

> ⚠ **账号风险须知**：QQ 非官方协议接入存在账号被限制的可能。**请务必使用专门注册的小号**，本项目作者不对任何账号后果负责。建议先拉小号进测试群体验。

---

## 它能做什么

- **每个群一个独立长记忆会话**：群友和她的聊天连续保留，主人还能在 DSH 面板里直接插话、翻看。
- **低打扰的群聊存在感**：被 @、被引用、叫名字必回；没被叫到时，只在话题真的和她有关、群里正热闹、过了冷却期时以小概率插话；加入话题后会顺着聊几句，话题走远就安静。
- **出厂安全默认**：总开关关、试运行（observe）开、白名单空——不配置一句话都不会发。试运行时她只在面板记录"我本来会说什么"。
- **长期记忆**：零外部依赖的中文 BM25 记忆库（二元切词 + 遗忘曲线 + 人物档案），2G 内存服务器也跑得动。
- **可微调人格**：面板直接改人格提示词，Markdown 人格卡，下一轮即时生效。
- **像真人的聊天节奏**：连发消息会攒齐一段再回；回复拆成多条气泡、带打字延迟；支持引用回复、真 @ 群成员、拍一拍。
- **双 preset 权限隔离**：主人私聊有完整工具（可帮你做事）；群聊和陌生人会话是纯聊天猫娘，没有任何本地工具。

## 它不做什么（有意的）

- 不内置 TTS 语音、翻唱、抖音/B站等重模块（保持 2G 可跑、行为可预期；后续作为可选模块提供）。
- 不打包、不自动下载 SnowLuma（其 EULA 要求用户自行安装并同意条款）。
- 不 fork DSH 内核——本项目是一个 DSH bundle 插件，内核随 npm 官方源更新。

---

## 快速开始

### Linux 云服务器（Ubuntu/Debian，2H2G 友好，无 Docker）

```bash
curl -fsSL https://你的分发地址/install.sh | sudo bash
# 国内网络慢可： sudo CN_MIRROR=1 bash install.sh
```

脚本会：装 Node 22（内存不足自动加 2G swap）→ 全局装 DSH → 建独立 `kinstra-neko` profile 并装本插件 → 引导装 NapCat（无桌面环境配 Xvfb 扫码）→ 注册 `kinstra-neko` systemd 服务（开机自启、`--max-old-space-size=700`）。

### Windows

```powershell
irm https://你的分发地址/install.ps1 | iex
```

Windows 推荐 [SnowLuma](https://github.com/SnowLuma/SnowLuma/releases/latest)（自行下载、本人同意条款后，面板里自动启停与接入小号），也支持任意 OneBot v11 实现。

### 已有 Node，只想装插件

```bash
npx kinstra-neko@latest init
dsh --profile kinstra-neko web --port 3090
```

### 装完之后（3 分钟向导）

1. 浏览器打开 `http://127.0.0.1:3090`（云服务器用 `http://<IP>:3090`，注意安全组放行）。
2. 按猫娘向导填：**猫娘小号 QQ**、**你的 QQ**。
3. 在 NapCat/SnowLuma 用小号扫码登录；连接页核对登录号。
4. 在 DSH 设置里配置模型服务商与 API Key（DeepSeek 官方或任意 OpenAI 兼容端点）。
5. 在「群聊与权限」里加白名单群。
6. 保持试运行，在群里 @ 她，到面板「试运行」页看她本来会说什么；确认对味，再关试运行开麦。

---

## 模型配置

DSH 支持 DeepSeek 官方与任意 OpenAI 兼容网关。密钥写 `~/.dsh/.credentials.yaml`，
provider/模型表写 profile 的 cordis 配置（DSH 设置页图形化完成，或安装器已引导）。

最小 OpenAI 兼容配置示例（`dsh-llm-pi-ai` 风格）：

```yaml
- name: '@deepseek-ai/dsh-llm-pi-ai'
  config:
    providers:
      deepseek:
        api: openai-completions
        baseURL: https://api.deepseek.com/v1
        apiKeyEnv: DEEPSEEK_API_KEY
        models:
          - id: deepseek-chat
            contextWindow: 131072
```

2G 服务器建议选上下文适中、单价低的对话模型；本项目的群会话 preset 已把
compaction 阈值调小（6144 字符触发、工具结果裁剪），控制长会话内存。

---

## 配置在哪

| 内容 | 位置 |
| --- | --- |
| 插件全部配置 | `~/.dsh/plugins-data/kinstra-neko/config.json`（一般只通过面板改） |
| 人格卡 | `~/.dsh/plugins-data/kinstra-neko/personas/*.md` |
| 长期记忆 | `~/.dsh/plugins-data/kinstra-neko/memory/facts.jsonl` |
| 试运行记录 | `~/.dsh/plugins-data/kinstra-neko/observe.jsonl` |
| 聊天→DSH 会话映射 | `~/.dsh/plugins-data/kinstra-neko/sessions.json` |
| 模型 API Key | `~/.dsh/.credentials.yaml`（0600） |
| profile / bundle | `~/.dsh/profiles/kinstra-neko/` |

## 常见运维（Linux）

```bash
sudo systemctl status kinstra-neko      # 状态
sudo systemctl restart kinstra-neko     # 重启
journalctl -u kinstra-neko -f           # 实时日志
free -h                                 # 确认 swap
```

面板「日志」标签也能看到插件侧最近 300 条分级日志。

---

## 调整猫娘的性格

面板「群聊与权限」：

- **插话概率 / 相关度门槛 / 每小时上限 / 冷却 / 静默时段**：控制她多爱说话。出厂偏安静。
- **叫醒词、兴趣词**：叫她名字必回；话题命中兴趣词更容易插话。
- **按群覆盖**：`config.group.overrides[群号]` 可为单个群单独调一套（后续面板化）。

面板「人格」：直接编辑 Markdown 人格卡。输出约定写在卡里：换行 = 多条气泡，
`[沉默]` = 不说话，`<reply:编号>` = 引用回复，`<at:QQ号>` = 真 @，`<poke>` = 拍一拍。
完整规则见 [`personas/neko.md`](personas/neko.md) 与源码 `src/persona/rules.ts`。

---

## 架构

```
QQ 小号
  ▲  OneBot v11（NapCat / SnowLuma / 任意实现；WS 收事件 + HTTP 调接口）
src/onebot, src/gateway
  ▼
chat hub（白名单 → 群聊决策 → 停顿分段 → 引用/@/拍一拍）
  ▼
DSH Session（一群一会话，kinstra-social / kinstra-private 两个 preset）
  + systemPrompt.variable 注入人格、context 注入记忆、会话级 remember/recall 工具
  ▼  turn/end + assistant/message
回复拆条 → 气泡延迟 → OneBot send_msg（试运行则只记 observe）
```

关键模块：

- `src/config` zod 配置 + 深合并默认 + 密钥脱敏
- `src/chat/group-policy.ts` 纯函数发言决策（单测覆盖）
- `src/chat/hub.ts` 消息中枢
- `src/memory/store.ts` JSONL + 热群 LRU 内存倒排索引（冷群不驻留）
- `src/sessions/manager.ts` DSH 会话生命周期
- `src/gateway/{napcat,snowluma}.ts` 协议端管理（SnowLuma 只注入核对过的机器人号）
- `src/host.ts` 插件入口与 `/kinstra/api/*` 管理接口
- `src/client` 品牌插槽、配置面板、首启向导（零 UI 库依赖的内联 React）

## 开发

```bash
pnpm install            # 或 npm install --legacy-peer-deps（DSH 是 pnpm 生态，npm 需此开关）
pnpm typecheck
pnpm test               # vitest，54 个用例
pnpm build              # 产物 lib/index.js + lib/client.js

# 装进本地 DSH 调试：
dsh kinstra-neko --from-default-profile web --dump-config >/dev/null   # 仅首次
dsh plugin --profile kinstra-neko add "link:$PWD"
dsh --profile kinstra-neko web --port 3090
```

无真实 QQ 环境时，用任意 OneBot v11 mock server（或 NapCat 的假事件）联调；
决策、消息解析、记忆、回复拆条均为纯函数，直接跑单测即可。

## 许可证

[MIT](LICENSE)。本项目代码不包含任何第三方 QQ 美术素材；品牌图标为原创 SVG。
接入的各协议端、DeepSeek Harness 各自遵循其许可证与条款。

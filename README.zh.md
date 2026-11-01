# dsh-windows-mcp

[English](https://github.com/helloHub1212/dsh-windows-mcp/blob/main/README.md) · **中文**

[![npm version](https://img.shields.io/npm/v/dsh-windows-mcp.svg)](https://www.npmjs.com/package/dsh-windows-mcp)
[![CI](https://github.com/helloHub1212/dsh-windows-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/helloHub1212/dsh-windows-mcp/actions/workflows/ci.yml)

**给 [DeepSeek Harness](https://github.com/sandbaseai/deepseek-harness-handbook) 接上 Windows 桌面自动化** —— 让 DSH 的 agent 能"看见"你的屏幕并操作你的电脑。

本插件把 [CursorTouch/Windows-MCP](https://github.com/CursorTouch/Windows-MCP) 接到 DSH 上，做法是**挂载 DSH 本体自带的那座 MCP 客户端桥**：不重新实现协议客户端，也不重复打包 MCP SDK。插件本身是一个 *carrier bundle*（只有补丁、没有自己的服务），agent 能用的一切能力都来自官方那座桥。

```text
DSH agent
  └─ 工具调用  mcp__windows__Screenshot
       └─ @deepseek-ai/dsh-mcp-client        （DSH 内置，由本插件的补丁行挂载）
            └─ uvx windows-mcp@0.8.8 serve   （stdio 子进程）
                 └─ 你的桌面：UIA 树 / Win32 输入 / 屏幕采集
```

## agent 能拿到什么

装好插件且 Windows-MCP 可启动后，工具列表里会出现：

| 工具 | 作用 |
| --- | --- |
| `mcp__windows__Screenshot` | 截屏；图片会作为**真正的图片附件**进入对话 |
| `mcp__windows__Snapshot` | 抓取无障碍树（纯文本，不花图片 token） |
| `mcp__windows__DisplayInventory` | 枚举显示器及其几何信息 |
| `mcp__windows__Click` / `Move` / `Scroll` | 鼠标输入 |
| `mcp__windows__Type` / `Shortcut` | 键盘输入 |
| `mcp__windows__Wait` / `WaitFor` | 等待固定时长，或等到某个界面条件成立 |
| `mcp__windows__Scrape` | 从窗口里抽取文本 |
| `mcp__windows__MultiSelect` / `MultiEdit` | 批量选中元素 / 批量编辑 |
| `mcp__windows__Clipboard` | 读写剪贴板 |
| `mcp__windows__Process` | 枚举、启动、结束进程 |
| `mcp__windows__Notification` | 读取通知 |
| `mcp__windows__Registry` | 读写注册表 |
| `mcp__windows__ControlStatus` | 控制环状态。**无法关闭**——上游强制保留 |
| `mcp__windows__App` | 启动/切换应用。*默认排除*（上游只在英文版 Windows 上稳定支持） |
| `mcp__windows__PowerShell` / `FileSystem` | *默认排除*——DSH 已有 shell 与文件工具 |

另外本插件自带一个工具 `windows_mcp_doctor`：当 `mcp__windows__*` 工具缺失时，用它查原因。

输入框工具行里还会多出一颗 **Computer Use** 胶囊（就在"访问模式"旁边）：显示当前真正注册了几个桌面工具，并在重启后记住你的选择（状态文件：`~/.dsh/dsh-windows-mcp.state.json`）。它默认是**关闭**的——全新安装不会把桌面交给 agent，直到你亲手点亮这颗胶囊。

关掉它是一道硬约束，不是提示：桥本身照常运行，但从下一步开始，每个 `mcp__windows__*` 工具都会从模型的工具表里消失；模型即便仍然报得出名字，调用也会在分发时被拒绝——对所有会话和子智能体同时生效，无需重启。重新打开后立即恢复；`windows_mcp_doctor` 始终报告当前开关状态。

> **已实测**：Windows 11 + DSH 桌面版 0.2.0-rc.2 下，桥那侧的服务公布 **18 个工具**
> （上游 21 个减去这里排除的 3 个），启动后约 1.5 秒就绪；每个工具都以
> `mcp__windows__<工具名>` 出现在模型的工具表里。

## 前置条件

- **Windows 10/11。**
- **DeepSeek Harness 桌面版**，且内置 `@deepseek-ai/dsh-mcp-client` 桥（0.2.0-rc.2 及以上）。
- 运行 DSH 的那个进程能在他自己的 `PATH` 上找到 **[uv](https://docs.astral.sh/uv/)**（插件用它在面板里装 Windows-MCP；DSH 本身启动不需要它）。即使没在 `PATH` 上，插件也会额外搜索 `%USERPROFILE%\.local\bin`。
- 想让 agent 真正**看到**截图，需要**支持图片输入的模型**。

### 启动永远不会被依赖卡住

桥那一行**出厂就是 disabled**，这是刻意的。`uvx` 式的首次启动会去包索引解析并下载
Windows-MCP 的 Python 依赖，慢网或被墙时这个解析能在 DSH 启动过程里挂几分钟——窗口一直停在
“Loading plugins…”。插件不应该有能力对宿主做这种事，所以：

- **装完 bundle 第一次启动：** DSH 照常秒开，暂时没有 Windows 工具，依赖状态显示为*未安装*（插件页和 **设置 → 桌面控制** 都这么说）。
- **在 设置 → 桌面控制 里安装依赖**（见下一节）：它会先探测 PyPI 镜像，把依赖装进插件自己的 toolchain 目录，
  然后把桥那一行重写成 `disabled: false` + `command:` 指向装好的可执行文件。
- **重启一次 DSH。** 之后桥直接拉起那个 exe —— 本机实测（Windows 11）**约 1.5 秒就绪**，不走网络。

`uv` 只由安装器用到。网络受限时，给 `uv` 配一次镜像（`%APPDATA%\uv\uv.toml`），手动/CLI
路径也能同样提速：

```toml
default-index = "https://mirrors.aliyun.com/pypi/simple"
```

## 安装

1. 打开 **DSH 桌面版 → 设置 → 插件**。
2. 添加本 bundle，目标可以是包名、仓库地址（`github:helloHub1212/dsh-windows-mcp`）或本仓库的本地目录。
3. **重启 DSH**，让新的补丁层在启动时合成。

非 Electron 的 profile 也可以用 CLI 完成同样的事：

```powershell
dsh plugin --profile <profile> add github:helloHub1212/dsh-windows-mcp
```

> Electron 独占 `desktop` profile，CLI 对它**任何**命令都会被拒绝（连只读 dump 也不行）。`desktop` 请走图形界面。

### 在应用里直接装依赖

Windows-MCP 本身是个 Python 程序，所以 **设置 → 桌面控制** 里的 **依赖** 卡片会显示它的状态并直接帮你装：

- **依赖** —— `已安装 0.8.8` / *未安装* / *未找到 uv*；
- **下载并安装** —— 跑一次 `uv tool install windows-mcp@<锁定版本>`（走实测最快的镜像），安装输出实时显示在页面上，过程中可以**取消**；
- 装完之后，插件会**自己把桥那一行写进你 profile 的 `cordis.patch.yml`**（先做带时间戳的备份，并用成对标记包住，可重复执行），写的是 `disabled: false` + `command:` 指向装好的可执行文件。**重启 DSH** 生效；之后桥直接拉起 exe，启动时不再解析任何包索引。

它写进去的就是 [换成固定的解释器](#换成固定的解释器不用-uvx) 里那条行；把标记之间的块删掉就回到出厂那条**禁用**的 `uvx` 行。**设置 → 插件** 里本插件的那一页只留一行状态并指向这里；启用 bundle 之后弹的提示则直接提供同一个安装按钮。

面板上还会显示 **写入目标**：手动写入会落到哪个 `cordis.patch.yml`，也就是这个宿主启动的那个 profile（`dsh --profile web` 启动的 web 宿主同样适用）。如果本插件装在多个 profile 里、而宿主没有报告自己启动的是哪一个，插件**不会猜**：它什么都不写并直接说明——给运行 DSH 的进程设 `DSH_WINDOWS_MCP_PROFILE=<profile 名>`（或 profile 的绝对路径）再重试。

### 更新 Windows-MCP，以及回退

同一个面板也管上游版本，所以升级不用再手动重装依赖：

- **自己检查。** 宿主启动时（以及页面要求时）插件会探测各 PyPI 镜像，取响应最快的那个读它的 `windows-mcp` 索引；结果在 `$DSH_HOME/dsh-windows-mcp.versions.json` 里缓存 6 小时，重启不会反复打网络。
- **版本各装各的。** 每个版本通过 `UV_TOOL_DIR` 装进自己的目录：`$DSH_HOME/dsh-windows-mcp/toolchain/<版本>/windows-mcp`。激活一个版本只是重写桥那一行（同样先备份），**不需要重装**，上一版原样留在磁盘上。
- **一键更新。** **更新到 vX** 会从能用的最快镜像下载该版本（失败自动换下一个镜像），校验可执行文件和 `dist-info` 之后再激活；面板会显示当前运行版本和它来自哪个镜像。
- **回退同样一键。** **回退到 vPrev** 把桥指回“当前版本替换掉的那个版本”，不下载任何东西。

只动插件自己管理的安装：在你安装第一个托管版本之前，桥仍然用全局 `uv tool` 装的那份；面板会标明当前生效的是 `uv-tool` 还是 `managed`。

### Python 依赖的镜像加速

检查阶段会用 96 KiB 的 range 读取量一遍七个候选——PyPI 官方，加上中科大、阿里云、腾讯云、华为云、南京大学、清华 TUNA——按实测吞吐量排序。安装时用最快且能用的镜像，失败就回退到下一个；同时固定 `UV_CONCURRENT_DOWNLOADS=4`、`UV_HTTP_RETRIES=3`、`UV_HTTP_TIMEOUT=600`，因为镜像会限流 uv 默认的 8 并发（HTTP 429）。对当前网络直接封锁的镜像（本机 TUNA 现在返回 403）会被排到后面而不是让安装失败；每个镜像的实测速度都显示在面板上。

### 设置页与 Star 按钮

除了插件卡片上的这些，还有几个不属于卡片的小开关，集中在 **设置 → 桌面控制** —— 设置界面左边栏里新增的一页，和别的插件页并列：

- **依赖** —— 安装、重装、更新、回退，以及「指向桥」按钮；带实时安装日志和写入目标。插件页只留一行指向这里。
- **桥接** —— `toolCallTimeoutMs`、截图缩放、截图后端、上游的闪光提示层，以及桥允许排除的三个工具（`App`、`PowerShell`、`FileSystem`）。这些会写进你 profile 的 `cordis.patch.yml` 桥行（先做时间戳备份），所以 **重启 DSH 后才生效**；页面上会写明当前生效的是哪一行。
- **更新** —— 是否在启动时自动检查新版 Windows-MCP，以及镜像策略：`auto` 用实测排序，指定镜像则固定用它（官方源始终留作最后的兜底）。
- **关于** —— 插件版本、仓库链接，以及一个「点个 Star」按钮，点开在新标签页打开 GitHub 仓库。

保存是原子的（`$DSH_HOME/dsh-windows-mcp.settings.json`）。越界的值会被夹到默认值并告知，而不是悄悄写坏；只改插件参数、不涉及桥行时不会重写补丁层。**还原** 把表单恢复成默认值。
## 验证

```text
windows_mcp_doctor
```

它会打印解析到的 `uv`/`uvx`/`python`、`%USERPROFILE%\.windows-mcp` 的状态、实际生效的 bridge 行，以及真正注册成功的 `mcp__windows__*` 工具名。然后对 agent 说：

> 截图我的桌面，告诉我屏幕上有什么。

## 配置

默认值都在 [`cordis.patch.yml`](cordis.patch.yml)，下面这些通过 `windows-mcp-bridge` 那一行的 `env` 调整。

| 变量 | 本插件默认 | 作用 |
| --- | --- | --- |
| `WINDOWS_MCP_SCREENSHOT_SCALE` | `0.75` | 截图缩放，`0.1`–`1.0`。对图片 token 开销影响最大的一个开关。 |
| `WINDOWS_MCP_DISABLE_FLASH` | `1` | 关掉上游每次截屏时那圈橙色"控制权已接管"边框。 |
| `WINDOWS_MCP_SCREENSHOT_BACKEND` | `auto` | 采集后端；覆盖前请先读上游文档。 |
| `WINDOWS_MCP_MAX_TREE_ELEMENTS` | `500` | `Snapshot` 返回的无障碍树元素上限。 |
| `WINDOWS_MCP_WATCHDOG` | `off` | 上游看门狗。默认关，因为它的 UIA 事件泵有可能把整个进程带崩（[上游 #332](https://github.com/CursorTouch/Windows-MCP/issues/332)）。 |
| `ANONYMIZED_TELEMETRY` | `false` | 上游默认**开启**（PostHog）。本插件关掉。 |

### 从自己的 profile 覆盖这一行

不要改插件自己的文件——在你 profile 的 `$DSH_HOME/profiles/<profile>/cordis.patch.yml` 里按 id 覆盖即可，它在 bundle 行**之后**合成，因此优先级更高。

**补丁是整块替换 `config`，不是深合并。** loader 的应用方式是 `target[key] = value`（`dsh-app-boot` 里的 `applyEntryPatches`），漏写哪个键就等于删掉哪个键：`serverName` 必填（它决定所有工具名）、`transport` 必填、stdio 形态下 `command` 必填、streamable-http 形态下 `url` 必填。`id` 不存在、或 `name` 与目标不匹配的补丁会被**跳过并告警**，而不是报错。

```yaml
# $DSH_HOME/profiles/<profile>/cordis.patch.yml —— 完整的一行
- id: windows-mcp-bridge
  config:
    serverName: windows
    transport: stdio
    command: uvx
    args: [windows-mcp@0.8.8, serve, --exclude-tools, "App,PowerShell,FileSystem"]
    toolCallTimeoutMs: 120000
    failOnStartupError: false
    reconnect: { enabled: true, initialDelayMs: 500, maxDelayMs: 30000, maxAttempts: 10 }
    env:
      ANONYMIZED_TELEMETRY: "false"
      WINDOWS_MCP_DISABLE_FLASH: "1"
      WINDOWS_MCP_SCREENSHOT_SCALE: "0.5"
```

`--exclude-tools` 的工具名是一个逗号分隔的参数（`"App,PowerShell,FileSystem"`），而 `ControlStatus` 始终保留——上游没有提供排除它的方式。

### 换成固定的解释器（不用 uvx）

`uvx` 每次启动都会重新解析包。要可复现，就装一次（`uv tool install windows-mcp`）或用任何一个已经装了它的 Python，然后改上面那份完整 `config` 里的 `command`/`args`：

```yaml
- id: windows-mcp-bridge
  config:
    serverName: windows
    transport: stdio
    command: windows-mcp          # 或者 C:\...\python.exe + args: [-m, windows_mcp, serve, ...]
    args: [serve, --exclude-tools, "App,PowerShell,FileSystem"]
    toolCallTimeoutMs: 120000
    failOnStartupError: false
    reconnect: { enabled: true, initialDelayMs: 500, maxDelayMs: 30000, maxAttempts: 10 }
    env: { ANONYMIZED_TELEMETRY: "false", WINDOWS_MCP_DISABLE_FLASH: "1", WINDOWS_MCP_SCREENSHOT_SCALE: "0.75" }
```

### 换成常驻 HTTP 服务

Windows-MCP 也能作为后台服务运行。上游的 `windows-mcp install` 会注册一个 ONLOGON 计划任务，在 `127.0.0.1:8000` 上提供 **streamable-http**；把这一行改成对应形态即可——这个形态用 `url`，没有 `command`/`args`/`env`：

```yaml
- id: windows-mcp-bridge
  config:
    serverName: windows
    transport: streamable-http
    url: http://127.0.0.1:8000/mcp/     # 上游打印的就是这个地址，结尾斜杠属于上游
    toolCallTimeoutMs: 120000
    failOnStartupError: false
    reconnect: { enabled: true, initialDelayMs: 500, maxDelayMs: 30000, maxAttempts: 10 }
```

这个形态没有 `env` 字段，所以遥测与截屏闪框的默认值不再生效：想要同样效果，就在启动服务时自己带上 `ANONYMIZED_TELEMETRY=false` 和 `WINDOWS_MCP_DISABLE_FLASH=1`。

好处是跨 DSH 重启存活、省掉每次启动开销，代价是有一个比应用活得更久的进程。两个需要留意的上游限制：`install` 会把计划任务绑到当时使用的解释器上（从临时 `uvx` 环境安装会注册出一个指向 uv 缓存目录、可能被回收的任务——请改用 `uv tool install windows-mcp` 或固定 venv）；非 loopback 地址在缺少 `--auth-key`/`--oauth-client-id` 时会拒绝启动（除非显式 `--allow-insecure-remote`）。

## 排障

| 现象 | 原因与处理 |
| --- | --- |
| 完全没有 `mcp__windows__*` 工具 | 跑 `windows_mcp_doctor`。全新安装时这是**预期**的：桥出厂是 disabled，要在 **设置 → 桌面控制** 里装完依赖、重启 DSH 之后才会启用。若依赖已装，看 doctor 打印的生效行里的 `disabled` / `command`，以及宿主日志里的 `mcp-client(windows)` 行。 |
| 升级后工具消失了 | 工具名是 `mcp__<serverName>__<tool>`。改 `serverName` 会改掉全部工具名（并打破 prompt 缓存前缀）。 |
| 截图返回的是文本 | 当前模型不接受图片输入，或你的 harness 配置里关掉了附件。上游的图片只有在准入成功时才会被投影。 |
| `App` 工具报错或没反应 | 上游明确说它只在英文版 Windows 上可靠；本插件默认已排除。 |
| DSH 启动明显变慢 | 桥不该占用启动时间：它出厂 `disabled: true`，只有安装后把 `command` 指到可执行文件才会启动。启动变慢说明**别的**行在引导期解析工具链——看 `windows_mcp_doctor` 打印的生效行。 |
| 截图里的字看不清 | 把 `WINDOWS_MCP_SCREENSHOT_SCALE` 提到接近 `1.0`；上游截图上限是 1920×1080。 |

## 安全

装上它，等于把鼠标、键盘、剪贴板、进程和注册表交给模型。请按"交出这个桌面会话的控制权"来评估。

设计上做了与没做的事：

- **默认不监听网络。** 默认行走 stdio：管道连接的子进程，不是监听端口。
- **子进程环境会清密。** 桥启动 MCP 子进程时会先做环境清洗：名字匹配 `KEY|PASSWORD|SECRET|TOKEN` 的变量、以及**所有 `DSH_*`** 变量都会被删掉，然后才合并配置里的 `env`。所以凭据必须显式写进该行的 `env`，不能指望继承。
- **本插件不发送遥测。** 上游自己的 PostHog 上报已在默认配置里显式关闭。
- **远程提供不是隐藏默认值。** 若你切到 HTTP，上游会强制 loopback 主机过滤，非 loopback 且无鉴权时拒绝启动。
- **本插件自己的路由没有鉴权。** `/dsh-windows-mcp/state`、`/prepare`、`/prepare/cancel`、`/bridge` 由和 UI 同一个 web 服务器提供，自身不做 token 校验。所以装了本插件的 DSH web 宿主**不要**用非 loopback 的 `--host` 暴露：能访问到它的人可以触发安装、或改写某个 profile 的补丁层。

## 原理

DSH 插件本质是 loader 补丁，而补丁行**可以挂载位于 Electron `app.asar` 里的包**——loader 会从桌面版安装锚点解析官方 `@deepseek-ai/*` 名字。第三方代码不能 `import` 这些包，但可以在补丁里**点名**它们，因为挂载发生在 loader 内部，而不是插件代码内部。这就是本包的全部诀窍：

```yaml
- insert:
    - id: windows-mcp-plugin
      name: dsh-windows-mcp                  # lib/index.js：doctor 工具 + 启动审计
    - id: windows-mcp-bridge
      name: "@deepseek-ai/dsh-mcp-client"    # 内置桥，按 Windows-MCP 配置
      disabled: true                          # 出厂禁用，等安装器把 command 指到 exe
      config: { transport: stdio, command: uvx, args: [windows-mcp@0.8.8, serve, ...] }
```

由此带来的几点值得知道：

- 集成的版本敏感性**只有一个方向**：bridge 的配置 schema 属于 DSH，不属于本插件。`package.json` 声明补丁，怎么读由 DSH 决定。
- 图片投影是**桥的功能**：MCP 图片块会被存成 DSH 附件并以原生图片内容呈现；音频与嵌入资源会退化成诊断文本。
- **MCP prompts 不被桥支持**（资源可以按需读取）。

## 开发

```powershell
npm install
npm test          # node --test，包含对补丁文件的真实 YAML 解析
npm run check     # node --check lib/index.js
```

想在不碰任何真实 profile、也不重启 DSH 的前提下看到合成后的配置，用 dump 工具：

```powershell
# 一次性：建一个影子 profile，复用真实 profile 的 node_modules
mkdir  $env:USERPROFILE\.dsh\profiles\dtest
copy   $env:USERPROFILE\.dsh\profiles\desktop\package.json $env:USERPROFILE\.dsh\profiles\dtest\
cmd /c mklink /J $env:USERPROFILE\.dsh\profiles\dtest\node_modules $env:USERPROFILE\.dsh\profiles\desktop\node_modules

npm run dump
```

目录结构：

```text
cordis.patch.yml      集成本体：两行 insert
lib/index.js          宿主半边：路由 + windows_mcp_doctor + 启动审计（零依赖）
lib/dependency.js     依赖状态、uv 调用封装、profile 桥行写入
lib/pypi.js           PyPI 索引解析与版本比较（纯函数）
lib/mirrors.js        镜像候选、限速探测与排序
lib/installs.js       按版本隔离的工具目录 + 版本状态文件
lib/updater.js        版本管理：检查 / 安装 / 激活 / 回退
lib/settings.js       用户设置：校验、落盘、桥行往返
lib/client.js         网页半边：输入框开关 + 插件面板 + 设置页
test/plugin.test.mjs  补丁合成测试 + 恶意 ctx 测试 + 面板测试
test/update.test.mjs  版本解析、镜像排序、版本隔离与回退状态机测试
test/settings.test.mjs 设置校验、桥行往返、设置路由测试
scripts/dump-config.mjs  面向影子 profile 的合成调试脚本
tools/                零依赖调试探针（不发布到 npm）
```

要对着真实网络和本机 profile 验证升级链路，用 `tools/update-e2e.mjs`：

```powershell
node tools/update-e2e.mjs --check          # 探测镜像并读出最新稳定版
node tools/update-e2e.mjs --install 0.8.8  # 真下载、真激活、真改桥行
node tools/update-e2e.mjs --rollback
```

欢迎贡献；请保持 `lib/index.js` 无运行时依赖，并保持 `apply()` 永不抛错。

## 致谢与许可

MIT —— 见 [LICENSE](LICENSE)。

- 真正干活的是 [CursorTouch/Windows-MCP](https://github.com/CursorTouch/Windows-MCP)（MIT），本插件只负责接线。
- MCP 客户端桥属于 DeepSeek Harness，本仓库不重新分发它。
- 与 DeepSeek 官方及 Windows-MCP 作者均无隶属关系。

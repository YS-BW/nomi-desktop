# Nomi Desktop

正式 desktop shell v1，当前实现为 **Tauri + React** 的单窗口远端聊天壳。

## 当前范围

- 连接 `nomi remote`
- 固定绑定单一 desktop session
- 查看历史消息
- 接收流式回复
- 中断当前轮
- 查看事件与状态
- 接收 `task_delivered`
- 主窗口产品化聊天布局
- 主窗口侧边栏在 connected 模式下直接读取远端 Nomi 的任务 / skills / MCP
- 主窗口已支持直接管理远端任务 / skills / MCP
- Skill 已支持从 desktop 上传 zip 到远端安装
- 左侧侧边栏现在是轻资源面板，任务卡片优先展示“下次执行 + 调度类型”
- 聊天正文支持 Markdown / GFM 渲染
- assistant 正文有前端节奏化显示，短回复也保留流式观感
- 同一轮 `progress / tool_hint` 会合并成一个可展开的过程块，而不是散落成多条日志卡片
- 可折叠调试区

## 当前结构

`desktop/` 现在固定分成三层：

- `src/transport/`
  - 负责 WebSocket 建连、命令发送、事件接收
  - Tauri 运行时走 `@tauri-apps/plugin-websocket + Authorization: Bearer`
  - 浏览器调试环境回退为 query token，仅用于本地调试
- `src/state/`
  - 负责连接状态、单 session 消息列表、active turn 与远端侧栏数据的归并
- `src/protocol/`
  - 负责消费共享 remote 协议契约
- `src/ui/`
  - 负责主窗口聊天壳

共享协议当前通过独立仓 `nomi-protocol` 提供。

本地联调默认使用：

- `github:YS-BW/nomi-protocol#v0.1.0`

默认 session 规则：

- 首次生成本机 `clientId`
- 默认 session 为 `desktop:{clientId}`
- 当前连接配置和 `clientId` 会保存在本地
- `main` 是唯一 remote 连接 owner
- 如果本地已经保存完整 `host / port / token`，desktop 启动后会自动连接 remote，并自动绑定默认 session
- 连接成功后会自动：
  - `bind_session`
  - `load_history`
  - `get_status`
  - `get_sidebar`
- 本地 user 气泡只会在远端 `send_message` 真正发出后追加，避免本地假成功
- 如果当前轮仍在进行，发送新消息会先发 `interrupt_turn`，再继续进入下一轮
- 主输入框默认 `Enter` 发送，`Shift+Enter` 换行
- 任务提醒正文不会再展示内部 `task_id` 前缀
- connected 模式下的“清空 .nomi”现在实际执行的是“清空远端运行态”，固定保留 `config.json`、`weixin`、`site-auth`

窗口规则：

- `main`
  - 聊天优先主窗口
  - 左侧展示当前远端服务器的任务、skills、MCP
  - 顶栏只保留产品头部、连接状态和当前会话摘要
  - 中间聊天记录与发送区
  - 侧边栏单独滚动，顶栏固定，聊天区单独滚动
  - 同一轮过程提示会聚合成单个可展开过程块
  - 调试信息降级为可折叠区域

## 启动

先安装依赖：

```bash
cd desktop
npm install
```

前端测试：

```bash
npm test
```

仅前端开发：

```bash
npm run dev
```

Tauri 开发模式：

```bash
npx tauri dev
```

生产构建：

```bash
npm run build
```

## 当前限制

- 还没有 tray / 通知 / 系统级后台常驻
- 当前连接配置先使用浏览器可复用的本地存储方案
- disconnected / mock 预览时，侧边栏仍可回退读取本地 `.nomi`
- 右侧常驻原始 JSON 调试栏已经移除，状态和事件流改为主窗口内按需展开

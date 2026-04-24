# Agent Flow

Agent Flow 是一个轻量级多 Agent 编排 CLI。它可以把用户的高层需求拆成可执行的扁平任务计划，由主 Agent 负责分析和重排任务，再由子 Agent 按依赖关系并发执行。

默认后端使用官方 Codex SDK，也可以切换到 OpenAI SDK runner。

English documentation: [README.md](README.md)

## 功能

- 支持一次性命令行参数，也支持交互式会话。
- 将用户需求拆分为带依赖关系的扁平任务计划。
- 执行前展示计划，允许用户确认或直接提出修改意见。
- 独立任务并发执行，有依赖的任务按顺序等待。
- 子 Agent 返回结果后，主 Agent 可以实时重排剩余 pending 任务。
- 交互模式下每轮完成后可以继续补充需求。
- 续聊默认继承原始需求和上一轮任务摘要。
- 执行计划和进度状态会保存到 `outputs/`。
- 支持显式输出路径，例如 `outputs/report.md`。
- 支持 Codex、OpenAI、fake 三种 runner 模式。

## 安装

安装依赖：

```bash
npm install
```

开发时作为本地 CLI 使用：

```bash
npm link
agent-flow "买牛奶; 写周报"
```

也可以不 link，直接运行：

```bash
npm start -- "买牛奶; 写周报"
node src/cli.js "买牛奶; 写周报"
```

## 使用方式

执行一次性任务：

```bash
agent-flow "调研两个测试框架; 对比它们; 保存结果到 outputs/frameworks.md"
```

启动交互模式：

```bash
agent-flow
```

交互模式下，Agent Flow 会先询问初始 todo list，展示主 Agent 生成的执行计划，并等待用户确认。每轮执行结束后，会出现续聊提示。下一轮会继承原始需求和上一轮任务结果摘要。

在计划确认提示中，你可以：

- 直接按 Enter 或输入 `yes` 接受计划。
- 输入修改意见，例如 `拆分第 2 个任务`、`调整顺序`、`删除保存步骤`。
- 输入 `no`，进入专门的计划修改提示。

在续聊提示中，你可以：

- 输入新的补充，例如 `重试失败的任务` 或 `把摘要追加到 outputs/report.md`。
- 直接按 Enter 结束会话。
- 输入 `exit` 或 `quit` 结束会话。

## Runner 模式

默认 Codex runner：

```bash
agent-flow "买牛奶; 写周报"
```

OpenAI runner：

```bash
export OPENAI_API_KEY=your_key_here
AGENT_FLOW_RUNNER=openai agent-flow "买牛奶; 写周报"
```

用于本地 smoke test 的 fake runner：

```bash
AGENT_FLOW_RUNNER=fake agent-flow "买牛奶; 写周报"
```

## 环境变量

- `AGENT_FLOW_RUNNER`：`codex`、`openai` 或 `fake`，默认是 `codex`。
- `AGENT_FLOW_MAIN_MODEL`：主 Agent 使用的 Codex 模型，默认是 `gpt-5.4`。
- `OPENAI_MODEL`：OpenAI runner 使用的模型，默认是 `gpt-5.2`。
- `OPENAI_API_KEY`：当 `AGENT_FLOW_RUNNER=openai` 时必须提供。
- `AGENT_FLOW_CODEX_TIMEOUT_MS`：Codex 主 Agent 和 runner 的超时时间。
- `AGENT_FLOW_MAIN_TIMEOUT_MS`：主 Agent 的超时时间。
- `AGENT_FLOW_OPENAI_TIMEOUT_MS`：OpenAI runner 的超时时间。

默认超时时间是 15 分钟。

## 输出文件

Agent Flow 会把运行时文件写入 `outputs/`：

- `outputs/execution-plan.md`：当前轮确认后的执行计划。
- `outputs/execution-progress.json`：可恢复的执行进度状态。
- `outputs/task-N/`：默认任务 artifact 目录。

如果任务明确指定了相对输出路径，例如 `outputs/report.md`、`docs/summary.md` 或 `artifacts/data.json`，runner 会要求子 Agent 将最终文件写到该路径，而不是嵌套到 `outputs/task-N` 下。

## 开发

运行测试：

```bash
npm test
```

检查 npm 包内容：

```bash
npm pack --dry-run
```

npm 包会暴露 `agent-flow` 命令，并且只包含 `src/`、`README.md` 和 `README.zh-CN.md`。

## 说明

- 任务保持扁平结构，依赖关系通过 `dependsOn` 表达。
- 主 Agent 重排任务时可以保留、删除、重排或新增 pending 任务。
- 已完成和正在运行的任务不会在重排时被修改。
- 交互模式是单进程会话；目前不会跨进程持久化完整聊天历史。
- 默认模式需要可用且已认证的 `codex` CLI，以及 `@openai/codex-sdk`。

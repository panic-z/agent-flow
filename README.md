# Agent Flow

Agent Flow is a small multi-agent orchestration CLI for turning a high-level request into executable flat tasks. It uses a main agent to plan and replan work, then runs child agents for each task with dependency-aware parallelism.

The default backend uses the official Codex SDK. OpenAI SDK mode is available as an option.

Chinese documentation: [README.zh-CN.md](README.zh-CN.md)

## Features

- Accepts one-off CLI arguments or starts an interactive session.
- Splits a request into a flat task plan with dependencies.
- Lets you accept the proposed plan or describe edits before execution.
- Runs independent tasks in parallel and waits for dependencies.
- Replans remaining pending work after child-agent feedback.
- Keeps interactive sessions open for follow-up requests.
- Carries summarized session context into follow-up rounds.
- Persists execution plans and progress state under `outputs/`.
- Preserves explicit output paths such as `outputs/report.md`.
- Supports Codex, OpenAI, and fake local runner modes.

## Install

Install dependencies:

```bash
npm install
```

Use as a local CLI during development:

```bash
npm link
agent-flow "buy milk; draft weekly update"
```

You can also run without linking:

```bash
npm start -- "buy milk; draft weekly update"
node src/cli.js "buy milk; draft weekly update"
```

## Usage

Run a one-off request:

```bash
agent-flow "research two test frameworks; compare them; save results to outputs/frameworks.md"
```

Start interactive mode:

```bash
agent-flow
```

In interactive mode, Agent Flow will ask for an initial todo list, show a proposed plan, and ask for confirmation. After a round completes, it prompts for a follow-up. Follow-ups inherit the original request and the previous round's task summaries.

At the plan confirmation prompt, you can:

- Press Enter or type `yes` to accept.
- Type feedback such as `split task 2`, `change the order`, or `remove the save step`.
- Type `no` to get a dedicated plan-edit prompt.

At the follow-up prompt, you can:

- Enter a new follow-up such as `retry the failed task` or `append a summary to outputs/report.md`.
- Press Enter to end the session.
- Type `exit` or `quit` to end the session.

## Runner Modes

Default Codex runner:

```bash
agent-flow "buy milk; draft weekly update"
```

OpenAI runner:

```bash
export OPENAI_API_KEY=your_key_here
AGENT_FLOW_RUNNER=openai agent-flow "buy milk; draft weekly update"
```

Fake runner for deterministic local smoke tests:

```bash
AGENT_FLOW_RUNNER=fake agent-flow "buy milk; draft weekly update"
```

## Environment Variables

- `AGENT_FLOW_RUNNER`: `codex`, `openai`, or `fake`. Defaults to `codex`.
- `AGENT_FLOW_MAIN_MODEL`: Main-agent Codex model. Defaults to `gpt-5.4`.
- `OPENAI_MODEL`: OpenAI runner model. Defaults to `gpt-5.2`.
- `OPENAI_API_KEY`: Required when `AGENT_FLOW_RUNNER=openai`.
- `AGENT_FLOW_CODEX_TIMEOUT_MS`: Timeout for Codex main agent and runner.
- `AGENT_FLOW_MAIN_TIMEOUT_MS`: Timeout for the main agent.
- `AGENT_FLOW_OPENAI_TIMEOUT_MS`: Timeout for the OpenAI runner.

The default timeout is 15 minutes.

## Outputs

Agent Flow writes runtime files under `outputs/`:

- `outputs/execution-plan.md`: The confirmed plan for the latest round.
- `outputs/execution-progress.json`: Resumable execution state.
- `outputs/task-N/`: Default task artifact directory.

If a task explicitly names a relative output path such as `outputs/report.md`, `docs/summary.md`, or `artifacts/data.json`, the runner asks the child agent to write the final file to that path instead of nesting it under `outputs/task-N`.

## Development

Run tests:

```bash
npm test
```

Check package contents:

```bash
npm pack --dry-run
```

The npm package exposes the `agent-flow` binary and includes only `src/`, `README.md`, and `README.zh-CN.md`.

## Notes

- Tasks remain flat; dependencies are represented by `dependsOn`.
- Main-agent replanning can keep, remove, reorder, or add pending tasks.
- Completed and currently running tasks are not modified during replanning.
- Interactive mode is a single-process session; long-term cross-process chat history is not persisted.
- Default mode requires a working authenticated `codex` CLI and `@openai/codex-sdk`.

# Agent Flow Demo

Minimal multi-agent orchestrator demo with a Node.js CLI. The default backend uses the official Codex SDK; OpenAI SDK mode is optional.

## What it does

- Accepts a todo list from CLI args or interactive input
- Uses a main agent to split the request into finer flat tasks
- Asks the user to confirm or re-enter the full list
- Shows dependency-aware execution waves before running
- Launches one child agent per task with parallel execution for independent tasks
- Aggregates task results into a final summary
- Passes completed task results into later tasks as explicit context
- Persists the execution plan and resumable progress state to `outputs/`
- Can save local artifacts returned by the model

## Run

Use the real Codex runner by default:

```bash
npm start -- "buy milk; draft weekly update"
```

Use the OpenAI runner explicitly:

```bash
export OPENAI_API_KEY=your_key_here
AGENT_FLOW_RUNNER=openai npm start -- "buy milk; draft weekly update"
```

Run with the fake runner for a local smoke test:

```bash
AGENT_FLOW_RUNNER=fake npm start -- "buy milk; draft weekly update"
```

Interactive mode:

```bash
npm start
```

## Test

```bash
npm test
```

## Notes

- Todo items are split on `;` or newlines
- The main agent prefers smaller single-action tasks and can produce explicit shortlist plus per-entity task chains
- Tasks stay flat and use `dependsOn` to express ordering and parallelism
- Default mode requires a working `codex` CLI and uses `@openai/codex-sdk`
- OpenAI mode requires `AGENT_FLOW_RUNNER=openai` and `OPENAI_API_KEY`
- OpenAI mode uses `gpt-5.2` by default; override with `OPENAI_MODEL`
- Codex timeout can be overridden with `AGENT_FLOW_CODEX_TIMEOUT_MS`
- OpenAI timeout can be overridden with `AGENT_FLOW_OPENAI_TIMEOUT_MS`
- Fake mode is intended for deterministic tests and local demos

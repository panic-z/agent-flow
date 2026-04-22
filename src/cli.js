import readline from "node:readline/promises";
import { stdin as input, stdout as output, stderr } from "node:process";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

import { CodexMainAgent } from "./agents/codex-main-agent.js";
import { runApp } from "./lib/app.js";
import { CodexRunner } from "./runners/codex-runner.js";
import { FakeRunner } from "./runners/fake-runner.js";
import { OpenAIRunner } from "./runners/openai-runner.js";

const execFile = promisify(execFileCallback);

export async function createRunnerFromEnv({
  env = process.env,
  cwd = process.cwd(),
} = {}) {
  const mode = env.AGENT_FLOW_RUNNER?.toLowerCase() ?? "codex";
  if (mode === "fake") {
    return new FakeRunner();
  }

  if (mode === "openai") {
    assertOpenAIConfig(env);
    return new OpenAIRunner({
      apiKey: env.OPENAI_API_KEY,
      cwd,
      timeoutMs: parseTimeoutMs(env.AGENT_FLOW_OPENAI_TIMEOUT_MS ?? env.AGENT_FLOW_CODEX_TIMEOUT_MS),
      model: env.OPENAI_MODEL ?? "gpt-5.2",
    });
  }

  await assertCodexAvailable();
  return new CodexRunner({
    cwd,
    timeoutMs: parseTimeoutMs(env.AGENT_FLOW_CODEX_TIMEOUT_MS),
  });
}

export async function main({
  argv = process.argv.slice(2),
  env = process.env,
  cwd = process.cwd(),
  stdin = input,
  stdout = output,
  stderrStream = stderr,
  processSignals = process,
  createReadline = ({ input: rlInput, output: rlOutput }) => readline.createInterface({ input: rlInput, output: rlOutput }),
  createMainAgent = () => createMainAgentFromEnv({ env, cwd }),
  createRunner = () => createRunnerFromEnv({ env, cwd }),
  runAppImpl = runApp,
} = {}) {
  const rl = createReadline({ input: stdin, output: stdout });
  let currentMainAgent = null;
  let currentRunner = null;
  let interrupted = false;
  let shutdownDone = false;

  const shutdownAgents = () => {
    if (shutdownDone) {
      return;
    }
    shutdownDone = true;
    currentMainAgent?.shutdown?.();
    currentRunner?.shutdown?.();
  };
  const handleInterrupt = () => {
    interrupted = true;
    shutdownAgents();
    rl.close();
  };

  processSignals.once?.("SIGINT", handleInterrupt);
  processSignals.once?.("SIGTERM", handleInterrupt);

  try {
    const result = await runAppImpl({
      args: argv,
      prompt: (question) => rl.question(question),
      write: (chunk) => stdout.write(chunk),
      createMainAgent: async () => {
        currentMainAgent = await createMainAgent();
        return currentMainAgent;
      },
      createRunner: async () => {
        currentRunner = await createRunner();
        return currentRunner;
      },
      cwd,
    });
    return result.exitCode;
  } catch (error) {
    if (interrupted || isInterruptError(error)) {
      return 130;
    }
    stderrStream.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  } finally {
    processSignals.off?.("SIGINT", handleInterrupt);
    processSignals.off?.("SIGTERM", handleInterrupt);
    shutdownAgents();
    rl.close();
  }
}

export async function createMainAgentFromEnv({
  env = process.env,
  cwd = process.cwd(),
} = {}) {
  const mode = env.AGENT_FLOW_RUNNER?.toLowerCase() ?? "codex";
  await assertCodexAvailable();
  if (mode === "openai") {
    assertOpenAIConfig(env);
  }

  return new CodexMainAgent({
    cwd,
    model: env.AGENT_FLOW_MAIN_MODEL ?? env.OPENAI_MODEL ?? "gpt-5.4",
    timeoutMs: parseTimeoutMs(env.AGENT_FLOW_MAIN_TIMEOUT_MS ?? env.AGENT_FLOW_CODEX_TIMEOUT_MS),
  });
}

export function assertOpenAIConfig(env = process.env) {
  if (!env.OPENAI_API_KEY) {
    throw new Error(
      "OPENAI_API_KEY is required when AGENT_FLOW_RUNNER=openai. Set it, or use the default codex runner.",
    );
  }
}

export async function assertCodexAvailable() {
  try {
    await execFile("codex", ["--version"], {
      cwd: process.cwd(),
      timeout: 10_000,
    });
  } catch {
    throw new Error(
      "Codex CLI is required for the default runner. Install/authenticate codex, or set AGENT_FLOW_RUNNER=openai with OPENAI_API_KEY.",
    );
  }
}

function parseTimeoutMs(value) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 60_000;
}

function isInterruptError(error) {
  return error instanceof Error && /Execution interrupted/.test(error.message);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const exitCode = await main();
  process.exitCode = exitCode;
}

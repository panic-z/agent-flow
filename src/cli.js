#!/usr/bin/env node
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
const DEFAULT_TIMEOUT_MS = 900_000;

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
    const prompt = (question) => rl.question(question);
    const write = (chunk) => stdout.write(chunk);
    const createMainAgentWithTracking = async () => {
      currentMainAgent = await createMainAgent();
      return currentMainAgent;
    };
    const createRunnerWithTracking = async () => {
      currentRunner = await createRunner();
      return currentRunner;
    };

    if (argv.length > 0) {
      const result = await runAppImpl({
        args: argv,
        prompt,
        write,
        createMainAgent: createMainAgentWithTracking,
        createRunner: createRunnerWithTracking,
        cwd,
      });
      return result.exitCode;
    }

    let exitCode = 0;
    let nextArgs = [(await prompt("Enter todo list: ")).trim()];
    let sessionContext;

    while (!interrupted) {
      if (nextArgs[0] === "") {
        break;
      }

      const result = await runAppImpl({
        args: nextArgs,
        prompt,
        write,
        createMainAgent: createMainAgentWithTracking,
        createRunner: createRunnerWithTracking,
        sessionContext,
        cwd,
      });
      exitCode = Math.max(exitCode, result.exitCode);
      sessionContext = result.sessionContext ?? sessionContext;

      write("\nYou can continue with a follow-up that will inherit the current session context.\n");
      const followUp = (await prompt("Continue with a follow-up (press Enter to exit, or type exit/quit): ")).trim();
      if (followUp === "" || followUp.toLowerCase() === "exit" || followUp.toLowerCase() === "quit") {
        break;
      }
      nextArgs = [followUp];
    }

    return interrupted ? 130 : exitCode;
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
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
}

function isInterruptError(error) {
  return error instanceof Error && /Execution interrupted/.test(error.message);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const exitCode = await main();
  process.exitCode = exitCode;
}

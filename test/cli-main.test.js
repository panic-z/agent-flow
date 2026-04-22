import test from "node:test";
import assert from "node:assert/strict";

import { assertCodexAvailable, assertOpenAIConfig, createRunnerFromEnv, main } from "../src/cli.js";
import { CodexRunner } from "../src/runners/codex-runner.js";
import { FakeRunner } from "../src/runners/fake-runner.js";
import { OpenAIRunner } from "../src/runners/openai-runner.js";

test("createRunnerFromEnv returns fake runner in test mode", async () => {
  const runner = await createRunnerFromEnv({
    env: { AGENT_FLOW_RUNNER: "fake" },
  });

  assert.ok(runner instanceof FakeRunner);
});

test("createRunnerFromEnv uses the codex runner by default", async () => {
  const runner = await createRunnerFromEnv({
    env: {
      AGENT_FLOW_RUNNER: "codex",
      AGENT_FLOW_CODEX_TIMEOUT_MS: "1500",
    },
  });

  assert.ok(runner instanceof CodexRunner);
  assert.equal(runner.timeoutMs, 1500);
});

test("createRunnerFromEnv passes timeout configuration to OpenAIRunner", async () => {
  const runner = await createRunnerFromEnv({
    env: {
      AGENT_FLOW_RUNNER: "openai",
      OPENAI_API_KEY: "test-key",
      AGENT_FLOW_OPENAI_TIMEOUT_MS: "1500",
    },
  });

  assert.ok(runner instanceof OpenAIRunner);
  assert.equal(runner.timeoutMs, 1500);
});

test("assertOpenAIConfig throws when OPENAI_API_KEY is missing", () => {
  assert.throws(
    () => assertOpenAIConfig({}),
    /OPENAI_API_KEY is required when AGENT_FLOW_RUNNER=openai/,
  );
});

test("assertCodexAvailable resolves when codex is installed", async () => {
  await assertCodexAvailable();
});

test("main shuts down the main agent and runner on SIGINT", async () => {
  const signalHandlers = new Map();
  let mainAgentShutdowns = 0;
  let runnerShutdowns = 0;

  const exitCode = await main({
    argv: ["demo task"],
    stdin: process.stdin,
    stdout: { write() {} },
    stderrStream: { write() {} },
    processSignals: {
      once(event, handler) {
        signalHandlers.set(event, handler);
      },
      off(event) {
        signalHandlers.delete(event);
      },
    },
    createReadline() {
      return {
        question() {
          throw new Error("question should not be called");
        },
        close() {},
      };
    },
    createMainAgent: async () => ({
      shutdown() {
        mainAgentShutdowns += 1;
      },
    }),
    createRunner: async () => ({
      shutdown() {
        runnerShutdowns += 1;
      },
    }),
    runAppImpl: async ({ createMainAgent, createRunner }) => {
      await createMainAgent();
      await createRunner();
      signalHandlers.get("SIGINT")?.();
      const error = new Error("Execution interrupted.");
      error.name = "AbortError";
      throw error;
    },
  });

  assert.equal(exitCode, 130);
  assert.equal(mainAgentShutdowns, 1);
  assert.equal(runnerShutdowns, 1);
});

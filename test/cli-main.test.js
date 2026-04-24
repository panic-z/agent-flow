import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

import { assertCodexAvailable, assertOpenAIConfig, createMainAgentFromEnv, createRunnerFromEnv, main } from "../src/cli.js";
import { CodexRunner } from "../src/runners/codex-runner.js";
import { FakeRunner } from "../src/runners/fake-runner.js";
import { OpenAIRunner } from "../src/runners/openai-runner.js";

test("package exposes agent-flow as an executable CLI bin", async () => {
  const packageJson = JSON.parse(await fs.readFile(new URL("../package.json", import.meta.url), "utf8"));
  const cliSource = await fs.readFile(new URL("../src/cli.js", import.meta.url), "utf8");

  assert.deepEqual(packageJson.bin, {
    "agent-flow": "./src/cli.js",
  });
  assert.deepEqual(packageJson.files, ["src", "README.md", "README.zh-CN.md"]);
  assert.match(cliSource, /^#!\/usr\/bin\/env node\n/);
});

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

test("createRunnerFromEnv defaults timeout to 15 minutes", async () => {
  const runner = await createRunnerFromEnv({
    env: {
      AGENT_FLOW_RUNNER: "codex",
    },
  });

  assert.ok(runner instanceof CodexRunner);
  assert.equal(runner.timeoutMs, 900_000);
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

test("createMainAgentFromEnv defaults timeout to 15 minutes", async () => {
  const agent = await createMainAgentFromEnv({
    env: {},
  });

  assert.equal(agent.timeoutMs, 900_000);
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

test("main keeps interactive mode open for follow-up rounds and exits on blank input", async () => {
  const prompts = [];
  const writes = [];
  const runCalls = [];

  const exitCode = await main({
    argv: [],
    stdin: process.stdin,
    stdout: { write(chunk) { writes.push(chunk); } },
    stderrStream: { write() {} },
    processSignals: {
      once() {},
      off() {},
    },
    createReadline() {
      return {
        async question(promptText) {
          prompts.push(promptText);
          if (promptText === "Enter todo list: ") {
            return "research harness frameworks";
          }
          if (/Continue with a follow-up/.test(promptText)) {
            return "";
          }
          throw new Error(`Unexpected prompt: ${promptText}`);
        },
        close() {},
      };
    },
    runAppImpl: async (options) => {
      runCalls.push({
        args: options.args,
        sessionContext: options.sessionContext,
      });
      return {
        exitCode: 0,
        tasks: [
          {
            id: 1,
            title: "Research harness frameworks",
            status: "success",
            resultSummary: "saved shortlist",
          },
        ],
        sessionContext: {
          originalRequest: "research harness frameworks",
          latestRoundTasks: [
            {
              id: 1,
              title: "Research harness frameworks",
              status: "success",
              resultSummary: "saved shortlist",
            },
          ],
        },
      };
    },
  });

  assert.equal(exitCode, 0);
  assert.equal(runCalls.length, 1);
  assert.deepEqual(runCalls[0].args, ["research harness frameworks"]);
  assert.equal(runCalls[0].sessionContext, undefined);
  assert.ok(prompts.some((prompt) => /Continue with a follow-up/.test(prompt)));
  assert.match(writes.join(""), /inherit the current session context/i);
});

test("main passes session context into the next interactive round", async () => {
  const runCalls = [];
  let continuePromptCount = 0;

  const exitCode = await main({
    argv: [],
    stdin: process.stdin,
    stdout: { write() {} },
    stderrStream: { write() {} },
    processSignals: {
      once() {},
      off() {},
    },
    createReadline() {
      return {
        async question(promptText) {
          if (promptText === "Enter todo list: ") {
            return "research harness frameworks";
          }
          if (/Continue with a follow-up/.test(promptText)) {
            continuePromptCount += 1;
            return continuePromptCount === 1 ? "compare the failed ones" : "exit";
          }
          throw new Error(`Unexpected prompt: ${promptText}`);
        },
        close() {},
      };
    },
    runAppImpl: async (options) => {
      runCalls.push({
        args: options.args,
        sessionContext: options.sessionContext,
      });
      const inputText = options.args.join(" ");
      return {
        exitCode: inputText.includes("compare")
          ? 1
          : 0,
        tasks: [
          {
            id: 1,
            title: inputText,
            status: inputText.includes("compare") ? "failed" : "success",
            resultSummary: inputText.includes("compare") ? "comparison failed" : "saved shortlist",
          },
        ],
        sessionContext: {
          originalRequest: "research harness frameworks",
          latestRoundTasks: [
            {
              id: 1,
              title: inputText,
              status: inputText.includes("compare") ? "failed" : "success",
              resultSummary: inputText.includes("compare") ? "comparison failed" : "saved shortlist",
            },
          ],
        },
      };
    },
  });

  assert.equal(exitCode, 1);
  assert.equal(runCalls.length, 2);
  assert.deepEqual(runCalls[1].args, ["compare the failed ones"]);
  assert.deepEqual(runCalls[1].sessionContext, {
    originalRequest: "research harness frameworks",
    latestRoundTasks: [
      {
        id: 1,
        title: "research harness frameworks",
        status: "success",
        resultSummary: "saved shortlist",
      },
    ],
  });
});

test("main preserves a non-zero interactive exit code after a later successful follow-up", async () => {
  let continuePromptCount = 0;

  const exitCode = await main({
    argv: [],
    stdin: process.stdin,
    stdout: { write() {} },
    stderrStream: { write() {} },
    processSignals: {
      once() {},
      off() {},
    },
    createReadline() {
      return {
        async question(promptText) {
          if (promptText === "Enter todo list: ") {
            return "first round fails";
          }
          if (/Continue with a follow-up/.test(promptText)) {
            continuePromptCount += 1;
            return continuePromptCount === 1 ? "second round succeeds" : "";
          }
          throw new Error(`Unexpected prompt: ${promptText}`);
        },
        close() {},
      };
    },
    runAppImpl: async (options) => {
      const inputText = options.args.join(" ");
      return {
        exitCode: inputText.includes("fails") ? 1 : 0,
        tasks: [
          {
            id: 1,
            title: inputText,
            status: inputText.includes("fails") ? "failed" : "success",
            resultSummary: inputText.includes("fails") ? "failed" : "succeeded",
          },
        ],
        sessionContext: {
          originalRequest: "first round fails",
          latestRoundTasks: [
            {
              id: 1,
              title: inputText,
              status: inputText.includes("fails") ? "failed" : "success",
              resultSummary: inputText.includes("fails") ? "failed" : "succeeded",
            },
          ],
        },
      };
    },
  });

  assert.equal(exitCode, 1);
});

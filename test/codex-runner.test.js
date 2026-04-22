import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

import {
  CodexRunner,
  extractAgentResult,
  inferExecutionHints,
  resolveTaskExecutionPlan,
} from "../src/runners/codex-runner.js";

test("extractAgentResult parses a structured JSON string", () => {
  const result = extractAgentResult('{"status":"success","summary":"done","artifacts":["a.md"]}');

  assert.deepEqual(result, {
    status: "success",
    summary: "done",
    artifacts: ["a.md"],
    rawOutput: '{"status":"success","summary":"done","artifacts":["a.md"]}',
  });
});

test("extractAgentResult throws when output is not valid JSON", () => {
  assert.throws(
    () => extractAgentResult("not json"),
    /No valid JSON result found/,
  );
});

test("resolveTaskExecutionPlan increases timeout and creates an output directory for research artifacts", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-flow-codex-plan-"));
  const plan = await resolveTaskExecutionPlan({
    cwd: tempDir,
    baseTimeoutMs: 5_000,
    task: {
      id: 2,
      title: "画出他们的架构图并保存在本地",
      details: "先调研热门 harness 框架，再画出架构图并保存在本地",
    },
  });

  const stat = await fs.stat(plan.artifactDir);

  assert.equal(plan.timeoutMs, 20_000);
  assert.equal(stat.isDirectory(), true);
  assert.match(plan.relativeArtifactDir, /outputs\/task-2$/);
});

test("inferExecutionHints detects research and artifact requirements", () => {
  const hints = inferExecutionHints({
    title: "全网搜集热门的harness框架",
    details: "画出他们的架构图并保存在本地",
  });

  assert.deepEqual(hints, {
    requiresResearch: true,
    requiresLocalArtifacts: true,
  });
});

test("CodexRunner uses the Codex SDK thread with structured output", async () => {
  const seen = [];
  const runner = new CodexRunner({
    codexClient: {
      startThread(options) {
        seen.push({ type: "thread", options });
        return {
          async run(prompt, turnOptions) {
            seen.push({ type: "run", prompt, turnOptions });
            return {
              finalResponse: '{"status":"success","summary":"researched","artifacts":["outputs/task-1/harness.md"]}',
            };
          },
        };
      },
    },
    timeoutMs: 5_000,
    model: "gpt-5.4",
  });

  const result = await runner.runTask(
    {
      id: 1,
      title: "全网搜集热门的harness框架",
      details: "整理成 markdown",
    },
    {
      completedTasks: [
        {
          id: 0,
          title: "Earlier task",
          status: "success",
          resultSummary: "done",
          artifacts: ["outputs/task-0/input.md"],
        },
      ],
    },
  );

  assert.equal(result.status, "success");
  assert.equal(seen[0].options.model, "gpt-5.4");
  assert.equal(seen[0].options.webSearchEnabled, true);
  assert.equal(seen[0].options.networkAccessEnabled, true);
  assert.match(seen[1].prompt, /Previous completed task results:/);
  assert.match(seen[1].prompt, /outputs\/task-0\/input.md/);
  assert.ok(seen[1].turnOptions.outputSchema);
  assert.ok(seen[1].turnOptions.signal);
});

test("CodexRunner returns a failed result when the SDK throws", async () => {
  const runner = new CodexRunner({
    codexClient: {
      startThread() {
        return {
          async run() {
            throw new Error("request timed out");
          },
        };
      },
    },
  });

  const result = await runner.runTask({ id: 1, title: "Task", details: "task details" });

  assert.equal(result.status, "failed");
  assert.match(result.summary, /request timed out/);
});

test("CodexRunner emits diagnostic logs before start and on timeout", async () => {
  const logs = [];
  const runner = new CodexRunner({
    codexClient: {
      startThread() {
        return {
          async run() {
            const error = new Error("timed out");
            error.name = "AbortError";
            throw error;
          },
        };
      },
    },
    cwd: process.cwd(),
    timeoutMs: 5_000,
  });

  const result = await runner.runTask(
    {
      id: 2,
      title: "全网搜集热门的harness框架",
      details: "画出他们的架构图并保存在本地",
    },
    {
      completedTasks: [],
      onLog(message) {
        logs.push(message);
      },
    },
  );

  assert.equal(result.status, "failed");
  assert.match(logs.join("\n"), /Timeout budget: 20000ms/);
  assert.match(logs.join("\n"), /Web search: enabled/);
  assert.match(logs.join("\n"), /Artifact directory: outputs\/task-2/);
  assert.match(logs.join("\n"), /Child agent timed out after 20000ms/);
});

test("CodexRunner shutdown aborts the in-flight task", async () => {
  let abortSeen = false;
  const runner = new CodexRunner({
    codexClient: {
      startThread() {
        return {
          async run(_prompt, turnOptions) {
            await new Promise((resolve, reject) => {
              if (turnOptions.signal.aborted) {
                abortSeen = true;
                const error = new Error("aborted");
                error.name = "AbortError";
                reject(error);
                return;
              }
              turnOptions.signal.addEventListener("abort", () => {
                abortSeen = true;
                const error = new Error("aborted");
                error.name = "AbortError";
                reject(error);
              }, { once: true });
            });
          },
        };
      },
    },
  });

  const pending = runner.runTask({ id: 1, title: "Task", details: "task details" });
  runner.shutdown();

  await assert.rejects(pending, /Execution interrupted/);
  assert.equal(abortSeen, true);
});

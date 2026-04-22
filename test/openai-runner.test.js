import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

import {
  OpenAIRunner,
  extractSdkResult,
  inferExecutionHints,
  resolveTaskExecutionPlan,
} from "../src/runners/openai-runner.js";

test("extractSdkResult parses a structured JSON string", () => {
  const result = extractSdkResult('{"status":"success","summary":"done","artifacts":[],"file_writes":[]}');

  assert.deepEqual(result, {
    status: "success",
    summary: "done",
    artifacts: [],
    file_writes: [],
  });
});

test("extractSdkResult throws when output is not valid JSON", () => {
  assert.throws(
    () => extractSdkResult("not json"),
    /No valid JSON result found/,
  );
});

test("resolveTaskExecutionPlan increases timeout and creates an output directory for research artifacts", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-flow-plan-"));
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
  assert.match(plan.artifactDir, /outputs\/task-2$/);
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

test("OpenAIRunner uses web_search and previous task context for research tasks", async () => {
  const seen = [];
  const runner = new OpenAIRunner({
    client: {
      responses: {
        create: async (body, options) => {
          seen.push({ body, options });
          return {
            output_text: '{"status":"success","summary":"researched","artifacts":["outputs/task-1/harness.md"],"file_writes":[]}',
          };
        },
      },
    },
    model: "gpt-5.2",
    timeoutMs: 5_000,
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
  assert.equal(seen[0].body.model, "gpt-5.2");
  assert.deepEqual(seen[0].body.tools, [{ type: "web_search" }]);
  assert.match(seen[0].body.input, /Previous completed task results:/);
  assert.match(seen[0].body.input, /outputs\/task-0\/input.md/);
  assert.equal(seen[0].options.timeout, 10_000);
});

test("OpenAIRunner writes local artifacts from file_writes", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-flow-openai-"));
  const runner = new OpenAIRunner({
    cwd: tempDir,
    client: {
      responses: {
        create: async () => ({
          output_text: JSON.stringify({
            status: "success",
            summary: "diagram saved",
            artifacts: ["outputs/task-2/architecture.mmd"],
            file_writes: [
              {
                path: "outputs/task-2/architecture.mmd",
                content: "graph TD\nA-->B",
              },
            ],
          }),
        }),
      },
    },
  });

  const result = await runner.runTask({
    id: 2,
    title: "画出他们的架构图并保存在本地",
    details: "根据前面的调研结果生成 mermaid 架构图",
  });

  const saved = await fs.readFile(path.join(tempDir, "outputs/task-2/architecture.mmd"), "utf8");

  assert.equal(result.status, "success");
  assert.equal(saved, "graph TD\nA-->B");
  assert.deepEqual(result.artifacts, ["outputs/task-2/architecture.mmd"]);
});

test("OpenAIRunner returns a failed result when the SDK throws", async () => {
  const runner = new OpenAIRunner({
    client: {
      responses: {
        create: async () => {
          throw new Error("request timed out");
        },
      },
    },
  });

  const result = await runner.runTask({ id: 1, title: "Task", details: "task details" });

  assert.equal(result.status, "failed");
  assert.match(result.summary, /request timed out/);
});

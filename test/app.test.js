import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { runApp } from "../src/lib/app.js";
import { FakeRunner } from "../src/runners/fake-runner.js";
import { analyzeTodoText } from "../src/lib/todo-intake.js";

function normalizeOutput(output) {
  return output.join("").replace(/\x1b\[[0-9;]*m/g, "");
}

async function waitFor(predicate, timeoutMs = 200) {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for condition.");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function createFakeMainAgent(overrides = {}) {
  return {
    async analyzeTodo(input) {
      if (overrides[input]) {
        return overrides[input];
      }
      return analyzeTodoText(input);
    },
  };
}

test("runApp uses interactive input when no args are provided", async () => {
  const answers = ["buy milk; draft update", "yes"];
  const output = [];

  const result = await runApp({
    args: [],
    prompt: async () => answers.shift(),
    write: (chunk) => output.push(chunk),
    createMainAgent: async () => createFakeMainAgent(),
    createRunner: async () =>
      new FakeRunner([
        { status: "success", summary: "milk bought", artifacts: [], rawOutput: "" },
        { status: "success", summary: "update drafted", artifacts: [], rawOutput: "" },
      ]),
  });

  assert.equal(result.exitCode, 0);
  assert.match(normalizeOutput(output), /Stage 1\/4: analyzing your todo list\./);
  assert.match(normalizeOutput(output), /Proposed execution plan:/);
  assert.match(normalizeOutput(output), /Stage 3\/4: initializing sub-agent runner\./);
  assert.match(normalizeOutput(output), /Stage 4\/4: executing tasks\./);
  assert.match(normalizeOutput(output), /\[Progress\] 0\/2 tasks finished\./);
  assert.match(normalizeOutput(output), /1\. Buy milk/);
  assert.match(normalizeOutput(output), /2\. Draft update/);
});

test("runApp allows user to reject normalized tasks and re-enter the full list", async () => {
  const answers = ["bad task", "no", "first; second", "yes"];
  const output = [];

  const result = await runApp({
    args: [],
    prompt: async () => answers.shift(),
    write: (chunk) => output.push(chunk),
    createMainAgent: async () => createFakeMainAgent(),
    createRunner: async () => new FakeRunner(),
  });

  assert.equal(result.exitCode, 0);
  assert.match(normalizeOutput(output), /1\. First/);
  assert.match(normalizeOutput(output), /2\. Second/);
});

test("runApp treats an empty confirmation answer as yes", async () => {
  const answers = ["buy milk; draft update", ""];
  const output = [];

  const result = await runApp({
    args: [],
    prompt: async () => answers.shift(),
    write: (chunk) => output.push(chunk),
    createMainAgent: async () => createFakeMainAgent(),
    createRunner: async () =>
      new FakeRunner([
        { status: "success", summary: "milk bought", artifacts: [], rawOutput: "" },
        { status: "success", summary: "update drafted", artifacts: [], rawOutput: "" },
      ]),
  });

  assert.equal(result.exitCode, 0);
  assert.match(normalizeOutput(output), /Running #1\/2: Buy milk/);
});

test("runApp analyzes numbered lists before confirmation", async () => {
  const answers = ["yes"];
  const output = [];

  const result = await runApp({
    args: ["1. 全网搜集热门的harness框架 2. 画出他们的架构图并保存在本地"],
    prompt: async () => answers.shift(),
    write: (chunk) => output.push(chunk),
    createMainAgent: async () => createFakeMainAgent(),
    createRunner: async () =>
      new FakeRunner([
        { status: "success", summary: "research complete", artifacts: [], rawOutput: "" },
        { status: "success", summary: "diagram saved", artifacts: [], rawOutput: "" },
      ]),
  });

  assert.equal(result.exitCode, 0);
  assert.match(normalizeOutput(output), /I interpreted your request as 2 tasks\./);
  assert.match(normalizeOutput(output), /Stage 2\/4: waiting for your confirmation\./);
  assert.match(normalizeOutput(output), /1\. 全网搜集热门的harness框架/);
  assert.match(normalizeOutput(output), /2\. 画出他们的架构图并保存在本地/);
});

test("runApp asks the user to clarify when the todo looks like one ambiguous compound task", async () => {
  const answers = [
    "搜集热门 harness 框架并画出他们的架构图保存到本地",
    "1. 搜集热门 harness 框架 2. 画出他们的架构图并保存在本地",
    "yes",
  ];
  const output = [];

  const result = await runApp({
    args: [],
    prompt: async () => answers.shift(),
    write: (chunk) => output.push(chunk),
    createMainAgent: async () =>
      createFakeMainAgent({
        "搜集热门 harness 框架并画出他们的架构图保存到本地": {
          ...analyzeTodoText("搜集热门 harness 框架并画出他们的架构图保存到本地"),
          needsClarification: true,
          clarificationPrompt: "I am not confident this input maps cleanly to independent tasks.\nPlease rewrite or split the todo list before I continue.",
        },
      }),
    createRunner: async () =>
      new FakeRunner([
        { status: "success", summary: "research complete", artifacts: ["outputs/task-1/harness.md"], rawOutput: "" },
        { status: "success", summary: "diagram saved", artifacts: ["outputs/task-2/diagram.mmd"], rawOutput: "" },
      ]),
  });

  assert.equal(result.exitCode, 0);
  assert.match(normalizeOutput(output), /I am not confident this input maps cleanly to independent tasks\./);
  assert.match(normalizeOutput(output), /Please rewrite or split the todo list before I continue\./);
  assert.match(normalizeOutput(output), /1\. 搜集热门 harness 框架/);
  assert.match(normalizeOutput(output), /2\. 画出他们的架构图并保存在本地/);
});

test("runApp does not exit early when the main agent needs clarification and has no tasks yet", async () => {
  const answers = [
    "原始输入",
    "1. 搜集热门 harness 框架 2. 画出他们的架构图并保存在本地",
    "yes",
  ];
  const output = [];

  const result = await runApp({
    args: [],
    prompt: async () => answers.shift(),
    write: (chunk) => output.push(chunk),
    createMainAgent: async () =>
      createFakeMainAgent({
        原始输入: {
          summary: "I need clarification before I can build a reliable execution plan.",
          needsClarification: true,
          clarificationPrompt: "Please split this request into explicit tasks before I continue.",
          tasks: [],
        },
      }),
    createRunner: async () =>
      new FakeRunner([
        { status: "success", summary: "research complete", artifacts: [], rawOutput: "" },
        { status: "success", summary: "diagram saved", artifacts: [], rawOutput: "" },
      ]),
  });

  assert.equal(result.exitCode, 0);
  assert.match(normalizeOutput(output), /Please split this request into explicit tasks before I continue\./);
  assert.match(normalizeOutput(output), /1\. 搜集热门 harness 框架/);
  assert.doesNotMatch(normalizeOutput(output), /No tasks provided\./);
});

test("runApp uses a clearer clarification prompt label", async () => {
  const answers = [
    "原始输入",
    "1. 搜集热门 harness 框架 2. 画出他们的架构图并保存在本地",
    "yes",
  ];
  const seenPrompts = [];

  await runApp({
    args: [],
    prompt: async (question) => {
      seenPrompts.push(question.replace(/\x1b\[[0-9;]*m/g, ""));
      return answers.shift();
    },
    write: () => {},
    createMainAgent: async () =>
      createFakeMainAgent({
        原始输入: {
          summary: "I need clarification before I can build a reliable execution plan.",
          needsClarification: true,
          clarificationPrompt: "Please split this request into explicit tasks before I continue.",
          tasks: [],
        },
      }),
    createRunner: async () =>
      new FakeRunner([
        { status: "success", summary: "research complete", artifacts: [], rawOutput: "" },
        { status: "success", summary: "diagram saved", artifacts: [], rawOutput: "" },
      ]),
  });

  assert.ok(seenPrompts.includes("Please update the todo list with the clarification above: "));
});

test("runApp pauses and asks the user when a later task depends on a failed earlier result", async () => {
  const answers = ["yes", "skip"];
  const output = [];

  const result = await runApp({
    args: ["collect source material; publish final deliverable"],
    prompt: async () => answers.shift(),
    write: (chunk) => output.push(chunk),
    createMainAgent: async () =>
      createFakeMainAgent({
        "collect source material; publish final deliverable": {
          summary: "I interpreted your request as 2 tasks.",
          needsClarification: false,
          clarificationPrompt: "",
          tasks: [
            {
              id: 1,
              title: "Collect source material",
              details: "Collect source material",
              dependsOn: [],
              onDependencyFailure: "ask_user",
              dependencyFailurePrompt: "",
              status: "pending",
              resultSummary: "",
              rawOutput: "",
            },
            {
              id: 2,
              title: "Publish final deliverable",
              details: "Publish final deliverable",
              dependsOn: [1],
              onDependencyFailure: "ask_user",
              dependencyFailurePrompt: "Task 2 needs task 1 output. Choose retry, skip, or abort.",
              status: "pending",
              resultSummary: "",
              rawOutput: "",
            },
          ],
        },
      }),
    createRunner: async () =>
      new FakeRunner([
        { status: "failed", summary: "research timed out", artifacts: [], rawOutput: "" },
      ]),
  });

  assert.equal(result.exitCode, 1);
  assert.match(normalizeOutput(output), /Task #2 appears to depend on results from earlier tasks\./);
  assert.match(normalizeOutput(output), /The required earlier result is missing because a prior task failed\./);
  assert.match(normalizeOutput(output), /Task 2 needs task 1 output\. Choose retry, skip, or abort\./);
  assert.match(normalizeOutput(output), /Skipping #2 based on your instruction\./);
  assert.doesNotMatch(normalizeOutput(output), /Running #2\/2/);
});

test("runApp keeps going when the main agent does not mark a task as dependent", async () => {
  const answers = ["yes"];
  const output = [];

  const result = await runApp({
    args: ["collect source material; publish final deliverable"],
    prompt: async () => answers.shift(),
    write: (chunk) => output.push(chunk),
    createMainAgent: async () =>
      createFakeMainAgent({
        "collect source material; publish final deliverable": {
          summary: "I interpreted your request as 2 tasks.",
          needsClarification: false,
          clarificationPrompt: "",
          tasks: [
            {
              id: 1,
              title: "Collect source material",
              details: "Collect source material",
              dependsOn: [],
              onDependencyFailure: "ask_user",
              dependencyFailurePrompt: "",
              status: "pending",
              resultSummary: "",
              rawOutput: "",
            },
            {
              id: 2,
              title: "Publish final deliverable",
              details: "Publish final deliverable",
              dependsOn: [],
              onDependencyFailure: "ask_user",
              dependencyFailurePrompt: "",
              status: "pending",
              resultSummary: "",
              rawOutput: "",
            },
          ],
        },
      }),
    createRunner: async () =>
      new FakeRunner([
        { status: "failed", summary: "step one failed", artifacts: [], rawOutput: "" },
        { status: "success", summary: "step two still ran", artifacts: [], rawOutput: "" },
      ]),
  });

  assert.equal(result.exitCode, 1);
  assert.match(normalizeOutput(output), /Running #2\/2: Publish final deliverable/);
  assert.doesNotMatch(normalizeOutput(output), /appears to depend on results from earlier tasks/);
});

test("runApp follows the main agent's abort policy when dependencies are missing", async () => {
  const answers = ["yes"];
  const output = [];

  const result = await runApp({
    args: ["collect source material; publish final deliverable"],
    prompt: async () => answers.shift(),
    write: (chunk) => output.push(chunk),
    createMainAgent: async () =>
      createFakeMainAgent({
        "collect source material; publish final deliverable": {
          summary: "I interpreted your request as 2 tasks.",
          needsClarification: false,
          clarificationPrompt: "",
          tasks: [
            {
              id: 1,
              title: "Collect source material",
              details: "Collect source material",
              dependsOn: [],
              onDependencyFailure: "ask_user",
              dependencyFailurePrompt: "",
              status: "pending",
              resultSummary: "",
              rawOutput: "",
            },
            {
              id: 2,
              title: "Publish final deliverable",
              details: "Publish final deliverable",
              dependsOn: [1],
              onDependencyFailure: "abort",
              dependencyFailurePrompt: "Publishing without the source material would be misleading, so abort here.",
              status: "pending",
              resultSummary: "",
              rawOutput: "",
            },
          ],
        },
      }),
    createRunner: async () =>
      new FakeRunner([
        { status: "failed", summary: "step one failed", artifacts: [], rawOutput: "" },
      ]),
  });

  assert.equal(result.exitCode, 1);
  assert.match(normalizeOutput(output), /Publishing without the source material would be misleading, so abort here\./);
  assert.match(normalizeOutput(output), /Aborting execution based on the main agent's recommendation\./);
  assert.doesNotMatch(normalizeOutput(output), /Running #2\/2: Publish final deliverable/);
});

test("runApp prints runner diagnostics and periodic heartbeat logs for long tasks", async () => {
  const answers = ["yes"];
  const output = [];
  const timers = [];

  const result = await runApp({
    args: ["collect source material"],
    prompt: async () => answers.shift(),
    write: (chunk) => output.push(chunk),
    createMainAgent: async () =>
      createFakeMainAgent({
        "collect source material": {
          summary: "I interpreted your request as 1 task.",
          needsClarification: false,
          clarificationPrompt: "",
          tasks: [
            {
              id: 1,
              title: "Collect source material",
              details: "Collect source material",
              dependsOn: [],
              onDependencyFailure: "ask_user",
              dependencyFailurePrompt: "",
              status: "pending",
              resultSummary: "",
              rawOutput: "",
            },
          ],
        },
      }),
    createRunner: async () => ({
      async runTask(_task, context) {
        context.onLog("Timeout budget: 30000ms. Web search: enabled. Artifact directory: outputs/task-1");
        return {
          status: "success",
          summary: "done",
          artifacts: [],
          rawOutput: "",
        };
      },
    }),
    heartbeatMs: 15_000,
    createInterval(callback, intervalMs) {
      timers.push({ callback, intervalMs });
      return timers.length;
    },
    clearInterval() {},
  });

  assert.equal(result.exitCode, 0);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].intervalMs, 15_000);
  timers[0].callback();
  const rendered = normalizeOutput(output);
  assert.match(rendered, /\[Runner\] Timeout budget: 30000ms\. Web search: enabled\. Artifact directory: outputs\/task-1/);
  assert.match(rendered, /\[Heartbeat\] Task #1 has been running for 15s\./);
});

test("runApp emits ANSI color codes in terminal output", async () => {
  const answers = ["buy milk", ""];
  const output = [];

  const result = await runApp({
    args: [],
    prompt: async () => answers.shift(),
    write: (chunk) => output.push(chunk),
    createMainAgent: async () => createFakeMainAgent(),
    createRunner: async () =>
      new FakeRunner([
        { status: "success", summary: "milk bought", artifacts: [], rawOutput: "" },
      ]),
  });

  assert.equal(result.exitCode, 0);
  assert.match(output.join(""), /\x1b\[[0-9;]*m/);
});

test("runApp saves the execution plan and progress state to files", async () => {
  const answers = [""];
  const output = [];
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-flow-app-"));

  const result = await runApp({
    args: ["buy milk"],
    prompt: async () => answers.shift(),
    write: (chunk) => output.push(chunk),
    createMainAgent: async () => createFakeMainAgent(),
    createRunner: async () =>
      new FakeRunner([
        { status: "success", summary: "milk bought", artifacts: ["outputs/task-1/milk.md"], rawOutput: "" },
      ]),
    cwd: tempDir,
  });

  const planText = await fs.readFile(path.join(tempDir, "outputs", "execution-plan.md"), "utf8");
  const progress = JSON.parse(await fs.readFile(path.join(tempDir, "outputs", "execution-progress.json"), "utf8"));

  assert.equal(result.exitCode, 0);
  assert.match(planText, /# Execution Plan/);
  assert.match(planText, /Original input: buy milk/);
  assert.match(planText, /1\. Buy milk/);
  assert.equal(progress.runStatus, "completed");
  assert.match(progress.startedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(progress.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(progress.currentTaskId, null);
  assert.equal(progress.currentTaskTitle, "");
  assert.equal(progress.tasks.length, 1);
  assert.equal(progress.tasks[0].status, "success");
  assert.match(normalizeOutput(output), /\[Plan\] Saved execution plan to outputs\/execution-plan\.md/);
  assert.match(normalizeOutput(output), /\[State\] Saved execution progress to outputs\/execution-progress\.json/);
});

test("runApp resumes unfinished work from the saved progress file", async () => {
  const answers = [];
  const output = [];
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-flow-resume-"));
  await fs.mkdir(path.join(tempDir, "outputs"), { recursive: true });
  await fs.writeFile(
    path.join(tempDir, "outputs", "execution-progress.json"),
    JSON.stringify({
      version: 1,
      originalInput: "buy milk; draft update",
      runStatus: "in_progress",
      startedAt: "2026-04-23T00:00:00.000Z",
      updatedAt: "2026-04-23T00:01:00.000Z",
      currentTaskId: 2,
      currentTaskTitle: "Draft update",
      summary: "I interpreted your request as 2 tasks.",
      tasks: [
        {
          id: 1,
          title: "Buy milk",
          details: "Buy milk",
          dependsOn: [],
          onDependencyFailure: "ask_user",
          dependencyFailurePrompt: "",
          status: "success",
          resultSummary: "milk bought",
          artifacts: ["outputs/task-1/milk.md"],
          rawOutput: "",
        },
        {
          id: 2,
          title: "Draft update",
          details: "Draft update",
          dependsOn: [],
          onDependencyFailure: "ask_user",
          dependencyFailurePrompt: "",
          status: "pending",
          resultSummary: "",
          artifacts: [],
          rawOutput: "",
        },
      ],
    }, null, 2),
    "utf8",
  );

  const runner = new FakeRunner([
    { status: "success", summary: "update drafted", artifacts: ["outputs/task-2/update.md"], rawOutput: "" },
  ]);

  const result = await runApp({
    args: ["buy milk; draft update"],
    prompt: async () => answers.shift(),
    write: (chunk) => output.push(chunk),
    createMainAgent: async () => createFakeMainAgent(),
    createRunner: async () => runner,
    cwd: tempDir,
  });

  const progress = JSON.parse(await fs.readFile(path.join(tempDir, "outputs", "execution-progress.json"), "utf8"));

  assert.equal(result.exitCode, 0);
  assert.deepEqual(runner.calls, ["Draft update"]);
  assert.equal(progress.runStatus, "completed");
  assert.equal(progress.startedAt, "2026-04-23T00:00:00.000Z");
  assert.match(progress.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(progress.currentTaskId, null);
  assert.equal(progress.currentTaskTitle, "");
  assert.equal(progress.tasks[0].status, "success");
  assert.equal(progress.tasks[1].status, "success");
  assert.match(normalizeOutput(output), /\[Resume\] Resuming from outputs\/execution-progress\.json/);
  assert.match(normalizeOutput(output), /\[Progress\] 1\/2 tasks finished\./);
});

test("runApp records the current running task in persisted progress updates", async () => {
  const answers = [""];
  const output = [];
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-flow-current-task-"));
  const snapshots = [];

  const result = await runApp({
    args: ["buy milk"],
    prompt: async () => answers.shift(),
    write: (chunk) => output.push(chunk),
    createMainAgent: async () => createFakeMainAgent(),
    createRunner: async () => ({
      async runTask() {
        const snapshot = JSON.parse(await fs.readFile(path.join(tempDir, "outputs", "execution-progress.json"), "utf8"));
        snapshots.push(snapshot);
        return { status: "success", summary: "milk bought", artifacts: [], rawOutput: "" };
      },
    }),
    cwd: tempDir,
  });

  assert.equal(result.exitCode, 0);
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].runStatus, "in_progress");
  assert.equal(snapshots[0].currentTaskId, 1);
  assert.equal(snapshots[0].currentTaskTitle, "Buy milk");
});

test("runApp executes independent tasks in parallel with default concurrency", async () => {
  const answers = [""];
  const started = [];
  const deferreds = [];

  const appPromise = runApp({
    args: ["task one; task two; task three"],
    prompt: async () => answers.shift(),
    write: () => {},
    createMainAgent: async () => createFakeMainAgent(),
    createRunner: async () => ({
      async runTask(task) {
        started.push(task.title);
        return await new Promise((resolve) => {
          deferreds.push(() => resolve({
            status: "success",
            summary: `${task.title} done`,
            artifacts: [],
            rawOutput: "",
          }));
        });
      },
    }),
  });

  await waitFor(() => started.length === 3);
  assert.deepEqual([...started].sort(), ["Task one", "Task three", "Task two"]);
  deferreds.splice(0).forEach((resolve) => resolve());

  const result = await appPromise;
  assert.equal(result.exitCode, 0);
});

test("runApp waits for dependency completion before starting dependent tasks", async () => {
  const answers = ["yes"];
  const started = [];
  let resolveFirst;

  const appPromise = runApp({
    args: ["collect source material; publish final deliverable"],
    prompt: async () => answers.shift(),
    write: () => {},
    createMainAgent: async () =>
      createFakeMainAgent({
        "collect source material; publish final deliverable": {
          summary: "I interpreted your request as 2 tasks.",
          needsClarification: false,
          clarificationPrompt: "",
          tasks: [
            {
              id: 1,
              title: "Collect source material",
              details: "Collect source material",
              dependsOn: [],
              onDependencyFailure: "ask_user",
              dependencyFailurePrompt: "",
              status: "pending",
              resultSummary: "",
              rawOutput: "",
            },
            {
              id: 2,
              title: "Publish final deliverable",
              details: "Publish final deliverable",
              dependsOn: [1],
              onDependencyFailure: "ask_user",
              dependencyFailurePrompt: "",
              status: "pending",
              resultSummary: "",
              rawOutput: "",
            },
          ],
        },
      }),
    createRunner: async () => ({
      async runTask(task) {
        started.push(task.title);
        if (task.id === 1) {
          return await new Promise((resolve) => {
            resolveFirst = () => resolve({
              status: "success",
              summary: "done one",
              artifacts: [],
              rawOutput: "",
            });
          });
        }

        return {
          status: "success",
          summary: "done two",
          artifacts: [],
          rawOutput: "",
        };
      },
    }),
  });

  await waitFor(() => started.length === 1);
  assert.deepEqual(started, ["Collect source material"]);
  resolveFirst();
  await appPromise;
  assert.deepEqual(started, ["Collect source material", "Publish final deliverable"]);
});

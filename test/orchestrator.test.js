import test from "node:test";
import assert from "node:assert/strict";

import { runOrchestrator } from "../src/lib/orchestrator.js";
import { parseTodoText } from "../src/lib/todo-intake.js";
import { FakeRunner } from "../src/runners/fake-runner.js";

test("runOrchestrator executes tasks sequentially and aggregates results", async () => {
  const tasks = parseTodoText("task one; task two");
  const runner = new FakeRunner([
    { status: "success", summary: "done one", artifacts: [], rawOutput: '{"status":"success"}' },
    { status: "success", summary: "done two", artifacts: [], rawOutput: '{"status":"success"}' },
  ]);

  const progressEvents = [];
  const summary = await runOrchestrator({ tasks, runner });

  assert.deepEqual(runner.calls, ["Task one", "Task two"]);
  assert.equal(summary.successCount, 2);
  assert.equal(summary.failureCount, 0);
  assert.deepEqual(
    summary.tasks.map((task) => ({ status: task.status, summary: task.resultSummary })),
    [
      { status: "success", summary: "done one" },
      { status: "success", summary: "done two" },
    ],
  );
});

test("runOrchestrator reports progress before and after each task", async () => {
  const tasks = parseTodoText("task one; task two");
  const runner = new FakeRunner([
    { status: "success", summary: "done one", artifacts: [], rawOutput: "" },
    { status: "failed", summary: "done two", artifacts: [], rawOutput: "" },
  ]);
  const progressEvents = [];

  await runOrchestrator({
    tasks,
    runner,
    onProgress(event) {
      progressEvents.push(event);
    },
  });

  assert.deepEqual(progressEvents, [
    { phase: "start", completed: 0, total: 2, taskId: 1, successCount: 0, failureCount: 0 },
    { phase: "finish", completed: 1, total: 2, taskId: 1, successCount: 1, failureCount: 0 },
    { phase: "start", completed: 1, total: 2, taskId: 2, successCount: 1, failureCount: 0 },
    { phase: "finish", completed: 2, total: 2, taskId: 2, successCount: 1, failureCount: 1 },
  ]);
});

test("runOrchestrator marks a task failed when runner throws and continues", async () => {
  const tasks = parseTodoText("first; second");
  const runner = {
    calls: [],
    async runTask(task) {
      this.calls.push(task.title);
      if (task.id === 1) {
        throw new Error("spawn failed");
      }
      return { status: "success", summary: "second ok", artifacts: [], rawOutput: "" };
    },
  };

  const summary = await runOrchestrator({ tasks, runner });

  assert.deepEqual(runner.calls, ["First", "Second"]);
  assert.equal(summary.successCount, 1);
  assert.equal(summary.failureCount, 1);
  assert.deepEqual(
    summary.tasks.map((task) => ({ title: task.title, status: task.status, summary: task.resultSummary })),
    [
      { title: "First", status: "failed", summary: "spawn failed" },
      { title: "Second", status: "success", summary: "second ok" },
    ],
  );
});

test("runOrchestrator passes completed task results into the next task context", async () => {
  const tasks = parseTodoText("research harness; draw architecture");
  const seenContexts = [];
  const runner = {
    async runTask(task, context) {
      seenContexts.push({
        taskId: task.id,
        completedTasks: context.completedTasks.map((item) => ({
          id: item.id,
          title: item.title,
          status: item.status,
          resultSummary: item.resultSummary,
          artifacts: item.artifacts,
        })),
      });

      if (task.id === 1) {
        return {
          status: "success",
          summary: "researched harness list",
          artifacts: ["outputs/task-1/harness.md"],
          rawOutput: "",
        };
      }

      return {
        status: "success",
        summary: "diagram saved",
        artifacts: ["outputs/task-2/diagram.png"],
        rawOutput: "",
      };
    },
  };

  await runOrchestrator({ tasks, runner });

  assert.deepEqual(seenContexts, [
    { taskId: 1, completedTasks: [] },
    {
      taskId: 2,
      completedTasks: [
        {
          id: 1,
          title: "Research harness",
          status: "success",
          resultSummary: "researched harness list",
          artifacts: ["outputs/task-1/harness.md"],
        },
      ],
    },
  ]);
});

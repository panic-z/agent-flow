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

test("runApp includes session context when analyzing a follow-up round", async () => {
  const answers = ["yes"];
  const seenInputs = [];

  const result = await runApp({
    args: ["compare the failed items and propose a retry plan"],
    prompt: async () => answers.shift(),
    write: () => {},
    sessionContext: {
      originalRequest: "research three frameworks and save summaries",
      latestRoundTasks: [
        {
          id: 1,
          title: "Research framework A",
          status: "success",
          resultSummary: "Framework A summary saved",
        },
        {
          id: 2,
          title: "Research framework B",
          status: "failed",
          resultSummary: "Framework B site timed out",
        },
      ],
    },
    createMainAgent: async () => ({
      async analyzeTodo(input) {
        seenInputs.push(input);
        return {
          summary: "I interpreted your request as 1 task.",
          needsClarification: false,
          clarificationPrompt: "",
          tasks: [
            {
              id: 1,
              title: "Compare the failed items and propose a retry plan",
              details: "Compare the failed items and propose a retry plan",
              dependsOn: [],
              onDependencyFailure: "ask_user",
              dependencyFailurePrompt: "",
              status: "pending",
              resultSummary: "",
              rawOutput: "",
            },
          ],
        };
      },
    }),
    createRunner: async () =>
      new FakeRunner([
        { status: "success", summary: "retry plan drafted", artifacts: [], rawOutput: "" },
      ]),
  });

  assert.equal(result.exitCode, 0);
  assert.equal(seenInputs.length, 1);
  assert.match(seenInputs[0], /Session original request:\nresearch three frameworks and save summaries/);
  assert.match(seenInputs[0], /Previous round results:/);
  assert.match(seenInputs[0], /- \[success\] Research framework A: Framework A summary saved/);
  assert.match(seenInputs[0], /- \[failed\] Research framework B: Framework B site timed out/);
  assert.match(seenInputs[0], /New user follow-up:\ncompare the failed items and propose a retry plan/);
});

test("runApp includes the current follow-up when revising a follow-up round plan", async () => {
  const answers = ["retry only framework B", "add a verification step", "yes"];
  const seenInputs = [];

  const result = await runApp({
    args: [],
    prompt: async () => answers.shift(),
    write: () => {},
    sessionContext: {
      originalRequest: "research three frameworks and save summaries",
      latestRoundTasks: [
        {
          id: 1,
          title: "Research framework A",
          status: "success",
          resultSummary: "Framework A summary saved",
        },
        {
          id: 2,
          title: "Research framework B",
          status: "failed",
          resultSummary: "Framework B site timed out",
        },
      ],
    },
    createMainAgent: async () => ({
      async analyzeTodo(input) {
        seenInputs.push(input);
        if (seenInputs.length === 1) {
          return {
            summary: "I interpreted your follow-up as 1 task.",
            needsClarification: false,
            clarificationPrompt: "",
            tasks: [
              {
                id: 1,
                title: "Retry framework B",
                details: "Retry framework B",
                dependsOn: [],
                onDependencyFailure: "ask_user",
                dependencyFailurePrompt: "",
                status: "pending",
                resultSummary: "",
                rawOutput: "",
              },
            ],
          };
        }
        return {
          summary: "I revised the follow-up plan.",
          needsClarification: false,
          clarificationPrompt: "",
          tasks: [
            {
              id: 1,
              title: "Retry framework B",
              details: "Retry framework B",
              dependsOn: [],
              onDependencyFailure: "ask_user",
              dependencyFailurePrompt: "",
              status: "pending",
              resultSummary: "",
              rawOutput: "",
            },
            {
              id: 2,
              title: "Verify framework B retry result",
              details: "Verify framework B retry result",
              dependsOn: [1],
              onDependencyFailure: "ask_user",
              dependencyFailurePrompt: "",
              status: "pending",
              resultSummary: "",
              rawOutput: "",
            },
          ],
        };
      },
    }),
    createRunner: async () => new FakeRunner(),
  });

  assert.equal(result.exitCode, 0);
  assert.match(seenInputs[1], /Session original request:\nresearch three frameworks and save summaries/);
  assert.match(seenInputs[1], /Previous round results:/);
  assert.match(seenInputs[1], /Current round request:\nretry only framework B/);
  assert.match(seenInputs[1], /User feedback on the current plan:\nadd a verification step/);
});

test("runApp lets the user revise the proposed plan with direct feedback", async () => {
  const answers = ["bad task", "split it into first and second tasks", "yes"];
  const output = [];
  const seenInputs = [];

  const result = await runApp({
    args: [],
    prompt: async () => answers.shift(),
    write: (chunk) => output.push(chunk),
    createMainAgent: async () => ({
      async analyzeTodo(input) {
        seenInputs.push(input);
        if (seenInputs.length === 1) {
          return analyzeTodoText("bad task");
        }
        return {
          summary: "I revised the plan into 2 tasks.",
          needsClarification: false,
          clarificationPrompt: "",
          tasks: [
            {
              id: 1,
              title: "First",
              details: "First",
              dependsOn: [],
              onDependencyFailure: "ask_user",
              dependencyFailurePrompt: "",
              status: "pending",
              resultSummary: "",
              rawOutput: "",
            },
            {
              id: 2,
              title: "Second",
              details: "Second",
              dependsOn: [1],
              onDependencyFailure: "ask_user",
              dependencyFailurePrompt: "",
              status: "pending",
              resultSummary: "",
              rawOutput: "",
            },
          ],
        };
      },
    }),
    createRunner: async () => new FakeRunner(),
  });

  assert.equal(result.exitCode, 0);
  assert.match(normalizeOutput(output), /You can accept this plan, or reply with edits like "split task 2", "change the order", or "remove the save step"\./);
  assert.match(normalizeOutput(output), /1\. First/);
  assert.match(normalizeOutput(output), /2\. Second/);
  assert.match(seenInputs[1], /Original user request:\nbad task/);
  assert.match(seenInputs[1], /Current proposed plan:/);
  assert.match(seenInputs[1], /User feedback on the current plan:\nsplit it into first and second tasks/);
});

test("runApp prompts for plan feedback after the user types no at confirmation", async () => {
  const answers = ["bad task", "no", "change the order and add a save step", "yes"];
  const seenInputs = [];

  await runApp({
    args: [],
    prompt: async () => answers.shift(),
    write: () => {},
    createMainAgent: async () => ({
      async analyzeTodo(input) {
        seenInputs.push(input);
        if (seenInputs.length === 1) {
          return analyzeTodoText("bad task");
        }
        return {
          summary: "I revised the plan into 2 tasks.",
          needsClarification: false,
          clarificationPrompt: "",
          tasks: [
            {
              id: 1,
              title: "Do work",
              details: "Do work",
              dependsOn: [],
              onDependencyFailure: "ask_user",
              dependencyFailurePrompt: "",
              status: "pending",
              resultSummary: "",
              rawOutput: "",
            },
            {
              id: 2,
              title: "Save results",
              details: "Save results",
              dependsOn: [1],
              onDependencyFailure: "ask_user",
              dependencyFailurePrompt: "",
              status: "pending",
              resultSummary: "",
              rawOutput: "",
            },
          ],
        };
      },
    }),
    createRunner: async () => new FakeRunner(),
  });

  assert.match(seenInputs[1], /User feedback on the current plan:\nchange the order and add a save step/);
});

test("runApp uses a plan-editing confirmation prompt", async () => {
  const answers = ["buy milk; draft update", "yes"];
  const seenPrompts = [];

  await runApp({
    args: [],
    prompt: async (question) => {
      seenPrompts.push(question.replace(/\x1b\[[0-9;]*m/g, ""));
      return answers.shift();
    },
    write: () => {},
    createMainAgent: async () => createFakeMainAgent(),
    createRunner: async () => new FakeRunner(),
  });

  assert.ok(
    seenPrompts.includes("Press Enter to accept, type yes to continue, or describe what to change: "),
  );
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

test("runApp tells the user which tasks can run in parallel", async () => {
  const answers = ["yes"];
  const output = [];

  const result = await runApp({
    args: ["research frameworks; analyze framework A; analyze framework B; save results"],
    prompt: async () => answers.shift(),
    write: (chunk) => output.push(chunk),
    createMainAgent: async () =>
      createFakeMainAgent({
        "research frameworks; analyze framework A; analyze framework B; save results": {
          summary: "I interpreted your request as 4 tasks.",
          needsClarification: false,
          clarificationPrompt: "",
          tasks: [
            {
              id: 1,
              title: "Research frameworks",
              details: "Research frameworks",
              dependsOn: [],
              onDependencyFailure: "ask_user",
              dependencyFailurePrompt: "",
              status: "pending",
              resultSummary: "",
              rawOutput: "",
            },
            {
              id: 2,
              title: "Analyze framework A",
              details: "Analyze framework A",
              dependsOn: [1],
              onDependencyFailure: "ask_user",
              dependencyFailurePrompt: "",
              status: "pending",
              resultSummary: "",
              rawOutput: "",
            },
            {
              id: 3,
              title: "Analyze framework B",
              details: "Analyze framework B",
              dependsOn: [1],
              onDependencyFailure: "ask_user",
              dependencyFailurePrompt: "",
              status: "pending",
              resultSummary: "",
              rawOutput: "",
            },
            {
              id: 4,
              title: "Save results",
              details: "Save results",
              dependsOn: [2, 3],
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
        { status: "success", summary: "done 1", artifacts: [], rawOutput: "" },
        { status: "success", summary: "done 2", artifacts: [], rawOutput: "" },
        { status: "success", summary: "done 3", artifacts: [], rawOutput: "" },
        { status: "success", summary: "done 4", artifacts: [], rawOutput: "" },
      ]),
  });

  assert.equal(result.exitCode, 0);
  assert.match(normalizeOutput(output), /Parallel execution plan:/);
  assert.match(
    normalizeOutput(output),
    /Tasks in the same wave will run in parallel\. Later waves will wait for their dependencies\./,
  );
  assert.match(normalizeOutput(output), /Wave 1: 1\. Research frameworks/);
  assert.match(normalizeOutput(output), /Wave 2 \(parallel\): 2\. Analyze framework A \| 3\. Analyze framework B/);
  assert.match(normalizeOutput(output), /Wave 3: 4\. Save results/);
});

test("runApp shows an explicit shortlist task and per-entity parallel waves for finer plans", async () => {
  const answers = ["yes"];
  const output = [];

  const result = await runApp({
    args: ["调研热门框架并为每个框架生成架构图后保存"],
    prompt: async () => answers.shift(),
    write: (chunk) => output.push(chunk),
    createMainAgent: async () =>
      createFakeMainAgent({
        调研热门框架并为每个框架生成架构图后保存: {
          summary: "I interpreted your request as 11 tasks.",
          needsClarification: false,
          clarificationPrompt: "",
          tasks: [
            { id: 1, title: "调研热门框架", details: "调研热门框架", dependsOn: [], onDependencyFailure: "ask_user", dependencyFailurePrompt: "", status: "pending", resultSummary: "", rawOutput: "" },
            { id: 2, title: "筛选 Top 3 框架", details: "根据调研结果筛选 Top 3 框架", dependsOn: [1], onDependencyFailure: "abort", dependencyFailurePrompt: "", status: "pending", resultSummary: "", rawOutput: "" },
            { id: 3, title: "分析框架 A", details: "分析 shortlisted 框架 A", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "", status: "pending", resultSummary: "", rawOutput: "" },
            { id: 4, title: "生成框架 A 架构图", details: "生成框架 A 架构图", dependsOn: [3], onDependencyFailure: "skip", dependencyFailurePrompt: "", status: "pending", resultSummary: "", rawOutput: "" },
            { id: 5, title: "保存框架 A 结果", details: "保存框架 A 结果", dependsOn: [4], onDependencyFailure: "skip", dependencyFailurePrompt: "", status: "pending", resultSummary: "", rawOutput: "" },
            { id: 6, title: "分析框架 B", details: "分析 shortlisted 框架 B", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "", status: "pending", resultSummary: "", rawOutput: "" },
            { id: 7, title: "生成框架 B 架构图", details: "生成框架 B 架构图", dependsOn: [6], onDependencyFailure: "skip", dependencyFailurePrompt: "", status: "pending", resultSummary: "", rawOutput: "" },
            { id: 8, title: "保存框架 B 结果", details: "保存框架 B 结果", dependsOn: [7], onDependencyFailure: "skip", dependencyFailurePrompt: "", status: "pending", resultSummary: "", rawOutput: "" },
            { id: 9, title: "分析框架 C", details: "分析 shortlisted 框架 C", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "", status: "pending", resultSummary: "", rawOutput: "" },
            { id: 10, title: "生成框架 C 架构图", details: "生成框架 C 架构图", dependsOn: [9], onDependencyFailure: "skip", dependencyFailurePrompt: "", status: "pending", resultSummary: "", rawOutput: "" },
            { id: 11, title: "保存框架 C 结果", details: "保存框架 C 结果", dependsOn: [10], onDependencyFailure: "skip", dependencyFailurePrompt: "", status: "pending", resultSummary: "", rawOutput: "" },
          ],
        },
      }),
    createRunner: async () =>
      new FakeRunner(Array.from({ length: 11 }, (_, index) => ({
        status: "success",
        summary: `done ${index + 1}`,
        artifacts: [],
        rawOutput: "",
      }))),
  });

  const rendered = normalizeOutput(output);
  assert.equal(result.exitCode, 0);
  assert.match(rendered, /2\. 筛选 Top 3 框架/);
  assert.match(rendered, /Wave 3 \(parallel\): 3\. 分析框架 A \| 6\. 分析框架 B \| 9\. 分析框架 C/);
  assert.match(rendered, /Wave 4 \(parallel\): 4\. 生成框架 A 架构图 \| 7\. 生成框架 B 架构图 \| 10\. 生成框架 C 架构图/);
  assert.match(rendered, /Wave 5 \(parallel\): 5\. 保存框架 A 结果 \| 8\. 保存框架 B 结果 \| 11\. 保存框架 C 结果/);
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

test("runApp does not allow accepting an empty revised plan", async () => {
  const answers = [
    "bad task",
    "remove everything",
    "",
    "make one concrete task",
    "yes",
  ];
  const output = [];
  const seenInputs = [];

  const result = await runApp({
    args: [],
    prompt: async () => answers.shift(),
    write: (chunk) => output.push(chunk),
    createMainAgent: async () => ({
      async analyzeTodo(input) {
        seenInputs.push(input);
        if (seenInputs.length === 1) {
          return analyzeTodoText("bad task");
        }
        if (seenInputs.length === 2) {
          return {
            summary: "No executable tasks remain.",
            needsClarification: false,
            clarificationPrompt: "",
            tasks: [],
          };
        }
        return {
          summary: "I revised the plan into 1 task.",
          needsClarification: false,
          clarificationPrompt: "",
          tasks: [
            {
              id: 1,
              title: "Concrete task",
              details: "Concrete task",
              dependsOn: [],
              onDependencyFailure: "ask_user",
              dependencyFailurePrompt: "",
              status: "pending",
              resultSummary: "",
              rawOutput: "",
            },
          ],
        };
      },
    }),
    createRunner: async () =>
      new FakeRunner([
        { status: "success", summary: "concrete done", artifacts: [], rawOutput: "" },
      ]),
  });

  assert.equal(result.exitCode, 0);
  assert.match(normalizeOutput(output), /No tasks detected, please try again\./);
  assert.match(normalizeOutput(output), /1\. Concrete task/);
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

test("runApp replans remaining work after a completed task and can add new pending tasks", async () => {
  const answers = ["yes"];
  const output = [];
  const started = [];
  const replanCalls = [];

  const result = await runApp({
    args: ["collect source material; publish final deliverable"],
    prompt: async () => answers.shift(),
    write: (chunk) => output.push(chunk),
    createMainAgent: async () => ({
      async analyzeTodo() {
        return {
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
        };
      },
      async replanRemainingTasks(context) {
        replanCalls.push({
          justCompletedTask: context.justCompletedTask.title,
          pendingTasks: context.pendingTasks.map((task) => ({ id: task.id, title: task.title })),
          completedTasks: context.completedTasks.map((task) => task.title),
        });
        if (context.justCompletedTask.id === 1) {
          return {
            summary: "Added a preparation step before publishing.",
            pendingTasks: [
              {
                id: 0,
                title: "Prepare appendix",
                details: "Prepare appendix",
                dependsOn: [1],
                onDependencyFailure: "ask_user",
                dependencyFailurePrompt: "",
              },
              {
                id: 2,
                title: "Publish final deliverable",
                details: "Publish final deliverable",
                dependsOn: [1, 3],
                onDependencyFailure: "ask_user",
                dependencyFailurePrompt: "",
              },
            ],
          };
        }
        return {
          summary: "No further changes.",
          pendingTasks: context.pendingTasks,
        };
      },
    }),
    createRunner: async () => ({
      async runTask(task) {
        started.push(task.title);
        return {
          status: "success",
          summary: `${task.title} done`,
          artifacts: [],
          rawOutput: "",
        };
      },
    }),
  });

  const rendered = normalizeOutput(output);
  assert.equal(result.exitCode, 0);
  assert.deepEqual(started, ["Collect source material", "Prepare appendix", "Publish final deliverable"]);
  assert.equal(replanCalls.length, 2);
  assert.deepEqual(replanCalls[0], {
    justCompletedTask: "Collect source material",
    pendingTasks: [{ id: 2, title: "Publish final deliverable" }],
    completedTasks: ["Collect source material"],
  });
  assert.match(rendered, /\[Replan\] Added a preparation step before publishing\./);
});

test("runApp ignores invalid replans and keeps executing the previous pending tasks", async () => {
  const answers = ["yes"];
  const output = [];
  const started = [];

  const result = await runApp({
    args: ["collect source material; publish final deliverable"],
    prompt: async () => answers.shift(),
    write: (chunk) => output.push(chunk),
    createMainAgent: async () => ({
      async analyzeTodo() {
        return {
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
        };
      },
      async replanRemainingTasks(context) {
        if (context.justCompletedTask.id === 1) {
          return {
            summary: "This replan is invalid.",
            pendingTasks: [
              {
                id: 2,
                title: "Publish final deliverable",
                details: "Publish final deliverable",
                dependsOn: [999],
                onDependencyFailure: "ask_user",
                dependencyFailurePrompt: "",
              },
            ],
          };
        }
        return {
          summary: "No further changes.",
          pendingTasks: context.pendingTasks,
        };
      },
    }),
    createRunner: async () => ({
      async runTask(task) {
        started.push(task.title);
        return {
          status: "success",
          summary: `${task.title} done`,
          artifacts: [],
          rawOutput: "",
        };
      },
    }),
  });

  const rendered = normalizeOutput(output);
  assert.equal(result.exitCode, 0);
  assert.deepEqual(started, ["Collect source material", "Publish final deliverable"]);
  assert.match(rendered, /\[Replan\] Skipped: Task #2 depends on unknown task #999\./);
});

test("runApp only blocks the failed entity chain while independent entity chains continue", async () => {
  const answers = ["yes"];
  const output = [];
  const started = [];

  const result = await runApp({
    args: ["调研热门框架并为每个框架生成架构图后保存"],
    prompt: async () => answers.shift(),
    write: (chunk) => output.push(chunk),
    createMainAgent: async () =>
      createFakeMainAgent({
        调研热门框架并为每个框架生成架构图后保存: {
          summary: "I interpreted your request as 8 tasks.",
          needsClarification: false,
          clarificationPrompt: "",
          tasks: [
            { id: 1, title: "调研热门框架", details: "调研热门框架", dependsOn: [], onDependencyFailure: "ask_user", dependencyFailurePrompt: "", status: "pending", resultSummary: "", rawOutput: "" },
            { id: 2, title: "筛选 Top 2 框架", details: "根据调研结果筛选 Top 2 框架", dependsOn: [1], onDependencyFailure: "abort", dependencyFailurePrompt: "", status: "pending", resultSummary: "", rawOutput: "" },
            { id: 3, title: "分析框架 A", details: "分析 shortlisted 框架 A", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "", status: "pending", resultSummary: "", rawOutput: "" },
            { id: 4, title: "生成框架 A 架构图", details: "生成框架 A 架构图", dependsOn: [3], onDependencyFailure: "skip", dependencyFailurePrompt: "", status: "pending", resultSummary: "", rawOutput: "" },
            { id: 5, title: "保存框架 A 结果", details: "保存框架 A 结果", dependsOn: [4], onDependencyFailure: "skip", dependencyFailurePrompt: "", status: "pending", resultSummary: "", rawOutput: "" },
            { id: 6, title: "分析框架 B", details: "分析 shortlisted 框架 B", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "", status: "pending", resultSummary: "", rawOutput: "" },
            { id: 7, title: "生成框架 B 架构图", details: "生成框架 B 架构图", dependsOn: [6], onDependencyFailure: "skip", dependencyFailurePrompt: "", status: "pending", resultSummary: "", rawOutput: "" },
            { id: 8, title: "保存框架 B 结果", details: "保存框架 B 结果", dependsOn: [7], onDependencyFailure: "skip", dependencyFailurePrompt: "", status: "pending", resultSummary: "", rawOutput: "" },
          ],
        },
      }),
    createRunner: async () => ({
      async runTask(task) {
        started.push(task.title);
        if (task.id === 4) {
          return { status: "failed", summary: "framework A diagram failed", artifacts: [], rawOutput: "" };
        }
        return { status: "success", summary: `${task.title} ok`, artifacts: [], rawOutput: "" };
      },
    }),
  });

  const rendered = normalizeOutput(output);
  assert.equal(result.exitCode, 1);
  assert.deepEqual(started.slice(0, 2), ["调研热门框架", "筛选 Top 2 框架"]);
  assert.deepEqual(started.slice(2, 4).sort(), ["分析框架 A", "分析框架 B"]);
  assert.deepEqual(started.slice(4, 6).sort(), ["生成框架 A 架构图", "生成框架 B 架构图"]);
  assert.equal(started[6], "保存框架 B 结果");
  assert.doesNotMatch(rendered, /Running #5\/8: 保存框架 A 结果/);
  assert.match(rendered, /Skipping #5/);
  assert.match(rendered, /Running #8\/8: 保存框架 B 结果/);
});

test("runApp persists finer object-level plans without schema changes", async () => {
  const answers = [""];
  const output = [];
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-flow-fine-plan-"));

  const result = await runApp({
    args: ["调研热门框架并为每个框架生成架构图后保存"],
    prompt: async () => answers.shift(),
    write: (chunk) => output.push(chunk),
    createMainAgent: async () =>
      createFakeMainAgent({
        调研热门框架并为每个框架生成架构图后保存: {
          summary: "I interpreted your request as 5 tasks.",
          needsClarification: false,
          clarificationPrompt: "",
          tasks: [
            { id: 1, title: "调研热门框架", details: "调研热门框架", dependsOn: [], onDependencyFailure: "ask_user", dependencyFailurePrompt: "", status: "pending", resultSummary: "", rawOutput: "" },
            { id: 2, title: "筛选 Top 1 框架", details: "根据调研结果筛选 Top 1 框架", dependsOn: [1], onDependencyFailure: "abort", dependencyFailurePrompt: "", status: "pending", resultSummary: "", rawOutput: "" },
            { id: 3, title: "分析框架 A", details: "分析 shortlisted 框架 A", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "", status: "pending", resultSummary: "", rawOutput: "" },
            { id: 4, title: "生成框架 A 架构图", details: "生成框架 A 架构图", dependsOn: [3], onDependencyFailure: "skip", dependencyFailurePrompt: "", status: "pending", resultSummary: "", rawOutput: "" },
            { id: 5, title: "保存框架 A 结果", details: "保存框架 A 结果", dependsOn: [4], onDependencyFailure: "skip", dependencyFailurePrompt: "", status: "pending", resultSummary: "", rawOutput: "" },
          ],
        },
      }),
    createRunner: async () =>
      new FakeRunner([
        { status: "success", summary: "research done", artifacts: [], rawOutput: "" },
        { status: "success", summary: "shortlist done", artifacts: [], rawOutput: "" },
        { status: "success", summary: "analysis done", artifacts: [], rawOutput: "" },
        { status: "success", summary: "diagram done", artifacts: [], rawOutput: "" },
        { status: "success", summary: "save done", artifacts: ["outputs/task-5/result.md"], rawOutput: "" },
      ]),
    cwd: tempDir,
  });

  const planText = await fs.readFile(path.join(tempDir, "outputs", "execution-plan.md"), "utf8");
  const progress = JSON.parse(await fs.readFile(path.join(tempDir, "outputs", "execution-progress.json"), "utf8"));

  assert.equal(result.exitCode, 0);
  assert.match(planText, /2\. 筛选 Top 1 框架/);
  assert.match(planText, /3\. 分析框架 A/);
  assert.deepEqual(progress.tasks.map((task) => task.title), [
    "调研热门框架",
    "筛选 Top 1 框架",
    "分析框架 A",
    "生成框架 A 架构图",
    "保存框架 A 结果",
  ]);
  assert.match(normalizeOutput(output), /\[Plan\] Saved execution plan to outputs\/execution-plan\.md/);
});

import test from "node:test";
import assert from "node:assert/strict";

import { CodexMainAgent } from "../src/agents/codex-main-agent.js";

test("CodexMainAgent returns structured finer task analysis from the Codex SDK", async () => {
  const seen = [];
  const agent = new CodexMainAgent({
    codexClient: {
      startThread(options) {
        seen.push({ type: "thread", options });
        return {
          async run(prompt, turnOptions) {
            seen.push({ type: "run", prompt, turnOptions });
            return {
              finalResponse: JSON.stringify({
                summary: "I interpreted your request as 8 tasks.",
                needsClarification: false,
                clarificationPrompt: "",
                tasks: [
                  {
                    title: "搜集热门 harness 框架",
                    details: "搜集热门 harness 框架",
                    dependsOn: [],
                    onDependencyFailure: "ask_user",
                    dependencyFailurePrompt: "",
                  },
                  {
                    title: "筛选 Top 2 harness 框架",
                    details: "根据调研结果筛选 Top 2 harness 框架",
                    dependsOn: [1],
                    onDependencyFailure: "abort",
                    dependencyFailurePrompt: "This shortlist requires the research output first, so abort if task 1 fails.",
                  },
                  {
                    title: "分析框架 A",
                    details: "分析 shortlisted 框架 A",
                    dependsOn: [2],
                    onDependencyFailure: "skip",
                    dependencyFailurePrompt: "Skip this branch if the shortlist fails.",
                  },
                  {
                    title: "生成框架 A 架构图",
                    details: "生成框架 A 架构图",
                    dependsOn: [3],
                    onDependencyFailure: "skip",
                    dependencyFailurePrompt: "Skip this branch if framework A analysis fails.",
                  },
                  {
                    title: "保存框架 A 结果",
                    details: "保存框架 A 结果",
                    dependsOn: [4],
                    onDependencyFailure: "skip",
                    dependencyFailurePrompt: "Skip this branch if framework A diagram generation fails.",
                  },
                  {
                    title: "分析框架 B",
                    details: "分析 shortlisted 框架 B",
                    dependsOn: [2],
                    onDependencyFailure: "skip",
                    dependencyFailurePrompt: "Skip this branch if the shortlist fails.",
                  },
                  {
                    title: "生成框架 B 架构图",
                    details: "生成框架 B 架构图",
                    dependsOn: [6],
                    onDependencyFailure: "skip",
                    dependencyFailurePrompt: "Skip this branch if framework B analysis fails.",
                  },
                  {
                    title: "保存框架 B 结果",
                    details: "保存框架 B 结果",
                    dependsOn: [7],
                    onDependencyFailure: "skip",
                    dependencyFailurePrompt: "Skip this branch if framework B diagram generation fails.",
                  },
                ],
              }),
            };
          },
        };
      },
    },
  });

  const analysis = await agent.analyzeTodo("1. 搜集热门 harness 框架 2. 画出他们的架构图并保存在本地");

  assert.equal(analysis.tasks.length, 8);
  assert.equal(analysis.tasks[0].id, 1);
  assert.equal(analysis.tasks[1].id, 2);
  assert.deepEqual(analysis.tasks[0].dependsOn, []);
  assert.deepEqual(analysis.tasks[1].dependsOn, [1]);
  assert.equal(analysis.tasks[0].onDependencyFailure, "ask_user");
  assert.equal(analysis.tasks[1].onDependencyFailure, "abort");
  assert.equal(analysis.tasks[1].title, "筛选 Top 2 harness 框架");
  assert.deepEqual(analysis.tasks[2].dependsOn, [2]);
  assert.deepEqual(analysis.tasks[3].dependsOn, [3]);
  assert.deepEqual(analysis.tasks[5].dependsOn, [2]);
  assert.match(analysis.tasks[1].dependencyFailurePrompt, /requires the research output/);
  assert.equal(seen[0].options.skipGitRepoCheck, true);
  assert.ok(seen[1].turnOptions.outputSchema);
  assert.match(seen[1].prompt, /You are the main agent/);
  assert.match(seen[1].prompt, /default to smaller flat tasks/i);
});

test("CodexMainAgent falls back to a clarification analysis when the SDK returns invalid JSON", async () => {
  const agent = new CodexMainAgent({
    codexClient: {
      startThread() {
        return {
          async run() {
            return { finalResponse: "not json" };
          },
        };
      },
    },
  });

  const analysis = await agent.analyzeTodo("do several things");

  assert.equal(analysis.needsClarification, true);
  assert.equal(analysis.tasks.length, 0);
});

test("CodexMainAgent accepts an explicit shortlist plus per-entity task chain without retry", async () => {
  const prompts = [];
  const agent = new CodexMainAgent({
    codexClient: {
      startThread() {
        return {
          async run(prompt) {
            prompts.push(prompt);
            return {
              finalResponse: JSON.stringify({
                summary: "I interpreted your request as 8 tasks.",
                needsClarification: false,
                clarificationPrompt: "",
                tasks: [
                  {
                    title: "调研热门框架",
                    details: "调研热门框架",
                    dependsOn: [],
                    onDependencyFailure: "ask_user",
                    dependencyFailurePrompt: "",
                  },
                  {
                    title: "筛选 Top 2 框架",
                    details: "筛选 Top 2 框架",
                    dependsOn: [1],
                    onDependencyFailure: "abort",
                    dependencyFailurePrompt: "Shortlist depends on the research output.",
                  },
                  {
                    title: "分析框架 A",
                    details: "分析 shortlisted 框架 A",
                    dependsOn: [2],
                    onDependencyFailure: "skip",
                    dependencyFailurePrompt: "Skip this branch if shortlist generation fails.",
                  },
                  {
                    title: "生成框架 A 架构图",
                    details: "生成框架 A 架构图",
                    dependsOn: [3],
                    onDependencyFailure: "skip",
                    dependencyFailurePrompt: "Skip this branch if framework A analysis fails.",
                  },
                  {
                    title: "保存框架 A 结果",
                    details: "保存框架 A 结果",
                    dependsOn: [4],
                    onDependencyFailure: "skip",
                    dependencyFailurePrompt: "Skip this branch if framework A diagram generation fails.",
                  },
                  {
                    title: "分析框架 B",
                    details: "分析 shortlisted 框架 B",
                    dependsOn: [2],
                    onDependencyFailure: "skip",
                    dependencyFailurePrompt: "Skip this branch if shortlist generation fails.",
                  },
                  {
                    title: "生成框架 B 架构图",
                    details: "生成框架 B 架构图",
                    dependsOn: [6],
                    onDependencyFailure: "skip",
                    dependencyFailurePrompt: "Skip this branch if framework B analysis fails.",
                  },
                  {
                    title: "保存框架 B 结果",
                    details: "保存框架 B 结果",
                    dependsOn: [7],
                    onDependencyFailure: "skip",
                    dependencyFailurePrompt: "Skip this branch if framework B diagram generation fails.",
                  },
                ],
              }),
            };
          },
        };
      },
    },
  });

  const analysis = await agent.analyzeTodo("调研热门框架并为每个框架生成架构图后保存");

  assert.equal(prompts.length, 1);
  assert.equal(analysis.needsClarification, false);
  assert.equal(analysis.tasks.length, 8);
  assert.equal(analysis.tasks[1].title, "筛选 Top 2 框架");
  assert.deepEqual(analysis.tasks[2].dependsOn, [2]);
  assert.deepEqual(analysis.tasks[3].dependsOn, [3]);
  assert.deepEqual(analysis.tasks[5].dependsOn, [2]);
});

test("CodexMainAgent retries once when the first plan is too coarse and returns the finer retry plan", async () => {
  const prompts = [];
  const responses = [
    JSON.stringify({
      summary: "I interpreted your request as 1 task.",
      needsClarification: false,
      clarificationPrompt: "",
      tasks: [
        {
          title: "调研热门框架并筛选合适方案，再为每个框架生成架构图并保存结果",
          details: "调研热门框架并筛选合适方案，再为每个框架生成架构图并保存结果",
          dependsOn: [],
          onDependencyFailure: "ask_user",
          dependencyFailurePrompt: "",
        },
      ],
    }),
    JSON.stringify({
      summary: "I interpreted your request as 11 tasks.",
      needsClarification: false,
      clarificationPrompt: "",
      tasks: [
        {
          title: "调研热门框架",
          details: "调研热门框架",
          dependsOn: [],
          onDependencyFailure: "ask_user",
          dependencyFailurePrompt: "",
        },
        {
          title: "筛选 Top 3 框架",
          details: "根据调研结果筛选 Top 3 框架",
          dependsOn: [1],
          onDependencyFailure: "abort",
          dependencyFailurePrompt: "Shortlist depends on the research output.",
        },
        {
          title: "分析框架 A",
          details: "分析 shortlisted 框架 A",
          dependsOn: [2],
          onDependencyFailure: "skip",
          dependencyFailurePrompt: "",
        },
        {
          title: "生成框架 A 架构图",
          details: "生成框架 A 架构图",
          dependsOn: [3],
          onDependencyFailure: "skip",
          dependencyFailurePrompt: "",
        },
        {
          title: "保存框架 A 结果",
          details: "保存框架 A 结果",
          dependsOn: [4],
          onDependencyFailure: "skip",
          dependencyFailurePrompt: "",
        },
        {
          title: "分析框架 B",
          details: "分析 shortlisted 框架 B",
          dependsOn: [2],
          onDependencyFailure: "skip",
          dependencyFailurePrompt: "",
        },
        {
          title: "生成框架 B 架构图",
          details: "生成框架 B 架构图",
          dependsOn: [6],
          onDependencyFailure: "skip",
          dependencyFailurePrompt: "",
        },
        {
          title: "保存框架 B 结果",
          details: "保存框架 B 结果",
          dependsOn: [7],
          onDependencyFailure: "skip",
          dependencyFailurePrompt: "",
        },
        {
          title: "分析框架 C",
          details: "分析 shortlisted 框架 C",
          dependsOn: [2],
          onDependencyFailure: "skip",
          dependencyFailurePrompt: "",
        },
        {
          title: "生成框架 C 架构图",
          details: "生成框架 C 架构图",
          dependsOn: [9],
          onDependencyFailure: "skip",
          dependencyFailurePrompt: "",
        },
        {
          title: "保存框架 C 结果",
          details: "保存框架 C 结果",
          dependsOn: [10],
          onDependencyFailure: "skip",
          dependencyFailurePrompt: "",
        },
      ],
    }),
  ];

  const agent = new CodexMainAgent({
    codexClient: {
      startThread() {
        return {
          async run(prompt) {
            prompts.push(prompt);
            return {
              finalResponse: responses.shift(),
            };
          },
        };
      },
    },
  });

  const analysis = await agent.analyzeTodo("调研热门框架并为每个框架生成架构图后保存");

  assert.equal(prompts.length, 2);
  assert.match(prompts[0], /default to smaller flat tasks/i);
  assert.match(prompts[1], /The previous plan was still too coarse/i);
  assert.match(prompts[1], /default to Top 3 shortlisted entities/i);
  assert.equal(analysis.needsClarification, false);
  assert.equal(analysis.tasks.length, 11);
  assert.equal(analysis.tasks[1].title, "筛选 Top 3 框架");
  assert.deepEqual(analysis.tasks[8].dependsOn, [2]);
});

test("CodexMainAgent falls back to clarification when the retry plan is still too coarse", async () => {
  const agent = new CodexMainAgent({
    codexClient: {
      startThread() {
        return {
          async run() {
            return {
              finalResponse: JSON.stringify({
                summary: "I interpreted your request as 1 task.",
                needsClarification: false,
                clarificationPrompt: "",
                tasks: [
                  {
                    title: "调研热门框架、分析结果、为每个框架生成架构图并保存",
                    details: "调研热门框架、分析结果、为每个框架生成架构图并保存",
                    dependsOn: [],
                    onDependencyFailure: "ask_user",
                    dependencyFailurePrompt: "",
                  },
                ],
              }),
            };
          },
        };
      },
    },
  });

  const analysis = await agent.analyzeTodo("调研热门框架并为每个框架生成架构图后保存");

  assert.equal(analysis.needsClarification, true);
  assert.equal(analysis.tasks.length, 0);
  assert.match(analysis.clarificationPrompt, /clearer task boundaries/i);
});

test("CodexMainAgent does not force per-entity chains when the user only asks for a shortlist and comparison", async () => {
  const prompts = [];
  const agent = new CodexMainAgent({
    codexClient: {
      startThread() {
        return {
          async run(prompt) {
            prompts.push(prompt);
            return {
              finalResponse: JSON.stringify({
                summary: "I interpreted your request as 3 tasks.",
                needsClarification: false,
                clarificationPrompt: "",
                tasks: [
                  {
                    title: "调研热门框架",
                    details: "调研热门框架",
                    dependsOn: [],
                    onDependencyFailure: "ask_user",
                    dependencyFailurePrompt: "",
                  },
                  {
                    title: "筛选 Top 3 框架",
                    details: "根据调研结果筛选 Top 3 框架",
                    dependsOn: [1],
                    onDependencyFailure: "abort",
                    dependencyFailurePrompt: "",
                  },
                  {
                    title: "对比 Top 3 框架",
                    details: "对比 shortlisted Top 3 框架",
                    dependsOn: [2],
                    onDependencyFailure: "skip",
                    dependencyFailurePrompt: "",
                  },
                ],
              }),
            };
          },
        };
      },
    },
  });

  const analysis = await agent.analyzeTodo("调研热门框架并对比 top 3");

  assert.equal(prompts.length, 1);
  assert.equal(analysis.needsClarification, false);
  assert.equal(analysis.tasks.length, 3);
  assert.equal(analysis.tasks[2].title, "对比 Top 3 框架");
});

test("CodexMainAgent accepts per-entity chains for generic entity names without framework keywords", async () => {
  const prompts = [];
  const agent = new CodexMainAgent({
    codexClient: {
      startThread() {
        return {
          async run(prompt) {
            prompts.push(prompt);
            return {
              finalResponse: JSON.stringify({
                summary: "I interpreted your request as 8 tasks.",
                needsClarification: false,
                clarificationPrompt: "",
                tasks: [
                  {
                    title: "调研热门 coding agents",
                    details: "调研热门 coding agents",
                    dependsOn: [],
                    onDependencyFailure: "ask_user",
                    dependencyFailurePrompt: "",
                  },
                  {
                    title: "筛选 Top 2 coding agents",
                    details: "根据调研结果筛选 Top 2 coding agents",
                    dependsOn: [1],
                    onDependencyFailure: "abort",
                    dependencyFailurePrompt: "",
                  },
                  {
                    title: "分析 Claude Code",
                    details: "分析 shortlisted Claude Code",
                    dependsOn: [2],
                    onDependencyFailure: "skip",
                    dependencyFailurePrompt: "",
                  },
                  {
                    title: "生成 Claude Code 架构图",
                    details: "生成 Claude Code 架构图",
                    dependsOn: [3],
                    onDependencyFailure: "skip",
                    dependencyFailurePrompt: "",
                  },
                  {
                    title: "保存 Claude Code 结果",
                    details: "保存 Claude Code 结果",
                    dependsOn: [4],
                    onDependencyFailure: "skip",
                    dependencyFailurePrompt: "",
                  },
                  {
                    title: "分析 Codex CLI",
                    details: "分析 shortlisted Codex CLI",
                    dependsOn: [2],
                    onDependencyFailure: "skip",
                    dependencyFailurePrompt: "",
                  },
                  {
                    title: "生成 Codex CLI 架构图",
                    details: "生成 Codex CLI 架构图",
                    dependsOn: [6],
                    onDependencyFailure: "skip",
                    dependencyFailurePrompt: "",
                  },
                  {
                    title: "保存 Codex CLI 结果",
                    details: "保存 Codex CLI 结果",
                    dependsOn: [7],
                    onDependencyFailure: "skip",
                    dependencyFailurePrompt: "",
                  },
                ],
              }),
            };
          },
        };
      },
    },
  });

  const analysis = await agent.analyzeTodo("调研热门 coding agents，并为每个 agent 生成架构图后保存");

  assert.equal(prompts.length, 1);
  assert.equal(analysis.needsClarification, false);
  assert.equal(analysis.tasks.length, 8);
  assert.equal(analysis.tasks[2].title, "分析 Claude Code");
  assert.equal(analysis.tasks[5].title, "分析 Codex CLI");
});

test("CodexMainAgent retries when the shortlist size does not match an explicit user quantity", async () => {
  const prompts = [];
  const responses = [
    JSON.stringify({
      summary: "I interpreted your request as 5 tasks.",
      needsClarification: false,
      clarificationPrompt: "",
      tasks: [
        {
          title: "调研热门框架",
          details: "调研热门框架",
          dependsOn: [],
          onDependencyFailure: "ask_user",
          dependencyFailurePrompt: "",
        },
        {
          title: "筛选 Top 3 框架",
          details: "根据调研结果筛选 Top 3 框架",
          dependsOn: [1],
          onDependencyFailure: "abort",
          dependencyFailurePrompt: "",
        },
        {
          title: "分析框架 A",
          details: "分析 shortlisted 框架 A",
          dependsOn: [2],
          onDependencyFailure: "skip",
          dependencyFailurePrompt: "",
        },
        {
          title: "生成框架 A 架构图",
          details: "生成框架 A 架构图",
          dependsOn: [3],
          onDependencyFailure: "skip",
          dependencyFailurePrompt: "",
        },
        {
          title: "保存框架 A 结果",
          details: "保存框架 A 结果",
          dependsOn: [4],
          onDependencyFailure: "skip",
          dependencyFailurePrompt: "",
        },
      ],
    }),
    JSON.stringify({
      summary: "I interpreted your request as 8 tasks.",
      needsClarification: false,
      clarificationPrompt: "",
      tasks: [
        {
          title: "调研热门框架",
          details: "调研热门框架",
          dependsOn: [],
          onDependencyFailure: "ask_user",
          dependencyFailurePrompt: "",
        },
        {
          title: "筛选 Top 2 框架",
          details: "根据调研结果筛选 Top 2 框架",
          dependsOn: [1],
          onDependencyFailure: "abort",
          dependencyFailurePrompt: "",
        },
        {
          title: "分析框架 A",
          details: "分析 shortlisted 框架 A",
          dependsOn: [2],
          onDependencyFailure: "skip",
          dependencyFailurePrompt: "",
        },
        {
          title: "生成框架 A 架构图",
          details: "生成框架 A 架构图",
          dependsOn: [3],
          onDependencyFailure: "skip",
          dependencyFailurePrompt: "",
        },
        {
          title: "保存框架 A 结果",
          details: "保存框架 A 结果",
          dependsOn: [4],
          onDependencyFailure: "skip",
          dependencyFailurePrompt: "",
        },
        {
          title: "分析框架 B",
          details: "分析 shortlisted 框架 B",
          dependsOn: [2],
          onDependencyFailure: "skip",
          dependencyFailurePrompt: "",
        },
        {
          title: "生成框架 B 架构图",
          details: "生成框架 B 架构图",
          dependsOn: [6],
          onDependencyFailure: "skip",
          dependencyFailurePrompt: "",
        },
        {
          title: "保存框架 B 结果",
          details: "保存框架 B 结果",
          dependsOn: [7],
          onDependencyFailure: "skip",
          dependencyFailurePrompt: "",
        },
      ],
    }),
  ];

  const agent = new CodexMainAgent({
    codexClient: {
      startThread() {
        return {
          async run(prompt) {
            prompts.push(prompt);
            return { finalResponse: responses.shift() };
          },
        };
      },
    },
  });

  const analysis = await agent.analyzeTodo("调研热门框架，筛选 top 2，并为每个框架生成架构图后保存");

  assert.equal(prompts.length, 2);
  assert.equal(analysis.needsClarification, false);
  assert.equal(analysis.tasks[1].title, "筛选 Top 2 框架");
});

test("CodexMainAgent rejects plans that expand fewer entity branches than the explicit shortlist size", async () => {
  const agent = new CodexMainAgent({
    codexClient: {
      startThread() {
        return {
          async run() {
            return {
              finalResponse: JSON.stringify({
                summary: "I interpreted your request as 5 tasks.",
                needsClarification: false,
                clarificationPrompt: "",
                tasks: [
                  {
                    title: "调研热门框架",
                    details: "调研热门框架",
                    dependsOn: [],
                    onDependencyFailure: "ask_user",
                    dependencyFailurePrompt: "",
                  },
                  {
                    title: "筛选 Top 2 框架",
                    details: "根据调研结果筛选 Top 2 框架",
                    dependsOn: [1],
                    onDependencyFailure: "abort",
                    dependencyFailurePrompt: "",
                  },
                  {
                    title: "分析框架 A",
                    details: "分析 shortlisted 框架 A",
                    dependsOn: [2],
                    onDependencyFailure: "skip",
                    dependencyFailurePrompt: "",
                  },
                  {
                    title: "生成框架 A 架构图",
                    details: "生成框架 A 架构图",
                    dependsOn: [3],
                    onDependencyFailure: "skip",
                    dependencyFailurePrompt: "",
                  },
                  {
                    title: "保存框架 A 结果",
                    details: "保存框架 A 结果",
                    dependsOn: [4],
                    onDependencyFailure: "skip",
                    dependencyFailurePrompt: "",
                  },
                ],
              }),
            };
          },
        };
      },
    },
  });

  const analysis = await agent.analyzeTodo("调研热门框架并为每个框架生成架构图后保存");

  assert.equal(analysis.needsClarification, true);
  assert.equal(analysis.tasks.length, 0);
});

test("CodexMainAgent retries when a Chinese quantity request is not reflected in the shortlist", async () => {
  const prompts = [];
  const responses = [
    JSON.stringify({
      summary: "I interpreted your request as 11 tasks.",
      needsClarification: false,
      clarificationPrompt: "",
      tasks: [
        {
          title: "调研热门框架",
          details: "调研热门框架",
          dependsOn: [],
          onDependencyFailure: "ask_user",
          dependencyFailurePrompt: "",
        },
        {
          title: "筛选 Top 3 框架",
          details: "根据调研结果筛选 Top 3 框架",
          dependsOn: [1],
          onDependencyFailure: "abort",
          dependencyFailurePrompt: "",
        },
        {
          title: "分析框架 A",
          details: "分析 shortlisted 框架 A",
          dependsOn: [2],
          onDependencyFailure: "skip",
          dependencyFailurePrompt: "",
        },
        {
          title: "生成框架 A 架构图",
          details: "生成框架 A 架构图",
          dependsOn: [3],
          onDependencyFailure: "skip",
          dependencyFailurePrompt: "",
        },
        {
          title: "保存框架 A 结果",
          details: "保存框架 A 结果",
          dependsOn: [4],
          onDependencyFailure: "skip",
          dependencyFailurePrompt: "",
        },
        {
          title: "分析框架 B",
          details: "分析 shortlisted 框架 B",
          dependsOn: [2],
          onDependencyFailure: "skip",
          dependencyFailurePrompt: "",
        },
        {
          title: "生成框架 B 架构图",
          details: "生成框架 B 架构图",
          dependsOn: [6],
          onDependencyFailure: "skip",
          dependencyFailurePrompt: "",
        },
        {
          title: "保存框架 B 结果",
          details: "保存框架 B 结果",
          dependsOn: [7],
          onDependencyFailure: "skip",
          dependencyFailurePrompt: "",
        },
        {
          title: "分析框架 C",
          details: "分析 shortlisted 框架 C",
          dependsOn: [2],
          onDependencyFailure: "skip",
          dependencyFailurePrompt: "",
        },
        {
          title: "生成框架 C 架构图",
          details: "生成框架 C 架构图",
          dependsOn: [9],
          onDependencyFailure: "skip",
          dependencyFailurePrompt: "",
        },
        {
          title: "保存框架 C 结果",
          details: "保存框架 C 结果",
          dependsOn: [10],
          onDependencyFailure: "skip",
          dependencyFailurePrompt: "",
        },
      ],
    }),
    JSON.stringify({
      summary: "I interpreted your request as 8 tasks.",
      needsClarification: false,
      clarificationPrompt: "",
      tasks: [
        {
          title: "调研热门框架",
          details: "调研热门框架",
          dependsOn: [],
          onDependencyFailure: "ask_user",
          dependencyFailurePrompt: "",
        },
        {
          title: "筛选前两个框架",
          details: "根据调研结果筛选前两个框架",
          dependsOn: [1],
          onDependencyFailure: "abort",
          dependencyFailurePrompt: "",
        },
        {
          title: "分析框架 A",
          details: "分析 shortlisted 框架 A",
          dependsOn: [2],
          onDependencyFailure: "skip",
          dependencyFailurePrompt: "",
        },
        {
          title: "生成框架 A 架构图",
          details: "生成框架 A 架构图",
          dependsOn: [3],
          onDependencyFailure: "skip",
          dependencyFailurePrompt: "",
        },
        {
          title: "保存框架 A 结果",
          details: "保存框架 A 结果",
          dependsOn: [4],
          onDependencyFailure: "skip",
          dependencyFailurePrompt: "",
        },
        {
          title: "分析框架 B",
          details: "分析 shortlisted 框架 B",
          dependsOn: [2],
          onDependencyFailure: "skip",
          dependencyFailurePrompt: "",
        },
        {
          title: "生成框架 B 架构图",
          details: "生成框架 B 架构图",
          dependsOn: [6],
          onDependencyFailure: "skip",
          dependencyFailurePrompt: "",
        },
        {
          title: "保存框架 B 结果",
          details: "保存框架 B 结果",
          dependsOn: [7],
          onDependencyFailure: "skip",
          dependencyFailurePrompt: "",
        },
      ],
    }),
  ];

  const agent = new CodexMainAgent({
    codexClient: {
      startThread() {
        return {
          async run(prompt) {
            prompts.push(prompt);
            return { finalResponse: responses.shift() };
          },
        };
      },
    },
  });

  const analysis = await agent.analyzeTodo("调研热门框架，筛选前两个框架，并为每个框架生成架构图后保存");

  assert.equal(prompts.length, 2);
  assert.equal(analysis.needsClarification, false);
  assert.equal(analysis.tasks[1].title, "筛选前两个框架");
});

test("CodexMainAgent ignores unrelated output counts when validating shortlist size", async () => {
  const prompts = [];
  const agent = new CodexMainAgent({
    codexClient: {
      startThread() {
        return {
          async run(prompt) {
            prompts.push(prompt);
            return {
              finalResponse: JSON.stringify({
                summary: "I interpreted your request as 9 tasks.",
                needsClarification: false,
                clarificationPrompt: "",
                tasks: [
                  {
                    title: "调研热门框架",
                    details: "调研热门框架",
                    dependsOn: [],
                    onDependencyFailure: "ask_user",
                    dependencyFailurePrompt: "",
                  },
                  {
                    title: "筛选 Top 3 框架",
                    details: "根据调研结果筛选 Top 3 框架",
                    dependsOn: [1],
                    onDependencyFailure: "abort",
                    dependencyFailurePrompt: "",
                  },
                  {
                    title: "分析框架 A",
                    details: "分析 shortlisted 框架 A",
                    dependsOn: [2],
                    onDependencyFailure: "skip",
                    dependencyFailurePrompt: "",
                  },
                  {
                    title: "生成框架 A 架构图",
                    details: "生成框架 A 架构图",
                    dependsOn: [3],
                    onDependencyFailure: "skip",
                    dependencyFailurePrompt: "",
                  },
                  {
                    title: "分析框架 B",
                    details: "分析 shortlisted 框架 B",
                    dependsOn: [2],
                    onDependencyFailure: "skip",
                    dependencyFailurePrompt: "",
                  },
                  {
                    title: "生成框架 B 架构图",
                    details: "生成框架 B 架构图",
                    dependsOn: [5],
                    onDependencyFailure: "skip",
                    dependencyFailurePrompt: "",
                  },
                  {
                    title: "分析框架 C",
                    details: "分析 shortlisted 框架 C",
                    dependsOn: [2],
                    onDependencyFailure: "skip",
                    dependencyFailurePrompt: "",
                  },
                  {
                    title: "生成框架 C 架构图",
                    details: "生成框架 C 架构图",
                    dependsOn: [7],
                    onDependencyFailure: "skip",
                    dependencyFailurePrompt: "",
                  },
                  {
                    title: "输出 2 个 markdown 文件",
                    details: "把最终结果写成 2 个 markdown 文件",
                    dependsOn: [4, 6, 8],
                    onDependencyFailure: "skip",
                    dependencyFailurePrompt: "",
                  },
                ],
              }),
            };
          },
        };
      },
    },
  });

  const analysis = await agent.analyzeTodo("调研热门框架，并为每个框架生成架构图，最后输出 2 个 markdown 文件");

  assert.equal(prompts.length, 1);
  assert.equal(analysis.needsClarification, false);
  assert.equal(analysis.tasks[1].title, "筛选 Top 3 框架");
  assert.equal(analysis.tasks[8].title, "输出 2 个 markdown 文件");
});

test("CodexMainAgent accepts shortlist plans that also include a shared comparison task", async () => {
  const prompts = [];
  const agent = new CodexMainAgent({
    codexClient: {
      startThread() {
        return {
          async run(prompt) {
            prompts.push(prompt);
            return {
              finalResponse: JSON.stringify({
                summary: "I interpreted your request as 9 tasks.",
                needsClarification: false,
                clarificationPrompt: "",
                tasks: [
                  {
                    title: "调研热门框架",
                    details: "调研热门框架",
                    dependsOn: [],
                    onDependencyFailure: "ask_user",
                    dependencyFailurePrompt: "",
                  },
                  {
                    title: "筛选 Top 2 框架",
                    details: "根据调研结果筛选 Top 2 框架",
                    dependsOn: [1],
                    onDependencyFailure: "abort",
                    dependencyFailurePrompt: "",
                  },
                  {
                    title: "对比 Top 2 框架",
                    details: "对比 shortlisted Top 2 框架",
                    dependsOn: [2],
                    onDependencyFailure: "skip",
                    dependencyFailurePrompt: "",
                  },
                  {
                    title: "分析框架 A",
                    details: "分析 shortlisted 框架 A",
                    dependsOn: [2],
                    onDependencyFailure: "skip",
                    dependencyFailurePrompt: "",
                  },
                  {
                    title: "生成框架 A 架构图",
                    details: "生成框架 A 架构图",
                    dependsOn: [4],
                    onDependencyFailure: "skip",
                    dependencyFailurePrompt: "",
                  },
                  {
                    title: "保存框架 A 结果",
                    details: "保存框架 A 结果",
                    dependsOn: [5],
                    onDependencyFailure: "skip",
                    dependencyFailurePrompt: "",
                  },
                  {
                    title: "分析框架 B",
                    details: "分析 shortlisted 框架 B",
                    dependsOn: [2],
                    onDependencyFailure: "skip",
                    dependencyFailurePrompt: "",
                  },
                  {
                    title: "生成框架 B 架构图",
                    details: "生成框架 B 架构图",
                    dependsOn: [7],
                    onDependencyFailure: "skip",
                    dependencyFailurePrompt: "",
                  },
                  {
                    title: "保存框架 B 结果",
                    details: "保存框架 B 结果",
                    dependsOn: [8],
                    onDependencyFailure: "skip",
                    dependencyFailurePrompt: "",
                  },
                ],
              }),
            };
          },
        };
      },
    },
  });

  const analysis = await agent.analyzeTodo("调研热门框架，对比 top 2，并为每个框架生成架构图后保存");

  assert.equal(prompts.length, 1);
  assert.equal(analysis.needsClarification, false);
  assert.equal(analysis.tasks.length, 9);
  assert.equal(analysis.tasks[2].title, "对比 Top 2 框架");
});

test("CodexMainAgent retries when an English word quantity is not reflected in the shortlist", async () => {
  const prompts = [];
  const responses = [
    JSON.stringify({
      summary: "I interpreted your request as 11 tasks.",
      needsClarification: false,
      clarificationPrompt: "",
      tasks: [
        {
          title: "Research popular frameworks",
          details: "Research popular frameworks",
          dependsOn: [],
          onDependencyFailure: "ask_user",
          dependencyFailurePrompt: "",
        },
        {
          title: "Shortlist Top 3 frameworks",
          details: "Shortlist Top 3 frameworks",
          dependsOn: [1],
          onDependencyFailure: "abort",
          dependencyFailurePrompt: "",
        },
        {
          title: "Analyze framework A",
          details: "Analyze shortlisted framework A",
          dependsOn: [2],
          onDependencyFailure: "skip",
          dependencyFailurePrompt: "",
        },
        {
          title: "Generate framework A diagram",
          details: "Generate framework A diagram",
          dependsOn: [3],
          onDependencyFailure: "skip",
          dependencyFailurePrompt: "",
        },
        {
          title: "Save framework A result",
          details: "Save framework A result",
          dependsOn: [4],
          onDependencyFailure: "skip",
          dependencyFailurePrompt: "",
        },
        {
          title: "Analyze framework B",
          details: "Analyze shortlisted framework B",
          dependsOn: [2],
          onDependencyFailure: "skip",
          dependencyFailurePrompt: "",
        },
        {
          title: "Generate framework B diagram",
          details: "Generate framework B diagram",
          dependsOn: [6],
          onDependencyFailure: "skip",
          dependencyFailurePrompt: "",
        },
        {
          title: "Save framework B result",
          details: "Save framework B result",
          dependsOn: [7],
          onDependencyFailure: "skip",
          dependencyFailurePrompt: "",
        },
        {
          title: "Analyze framework C",
          details: "Analyze shortlisted framework C",
          dependsOn: [2],
          onDependencyFailure: "skip",
          dependencyFailurePrompt: "",
        },
        {
          title: "Generate framework C diagram",
          details: "Generate framework C diagram",
          dependsOn: [9],
          onDependencyFailure: "skip",
          dependencyFailurePrompt: "",
        },
        {
          title: "Save framework C result",
          details: "Save framework C result",
          dependsOn: [10],
          onDependencyFailure: "skip",
          dependencyFailurePrompt: "",
        },
      ],
    }),
    JSON.stringify({
      summary: "I interpreted your request as 8 tasks.",
      needsClarification: false,
      clarificationPrompt: "",
      tasks: [
        {
          title: "Research popular frameworks",
          details: "Research popular frameworks",
          dependsOn: [],
          onDependencyFailure: "ask_user",
          dependencyFailurePrompt: "",
        },
        {
          title: "Shortlist top two frameworks",
          details: "Shortlist top two frameworks",
          dependsOn: [1],
          onDependencyFailure: "abort",
          dependencyFailurePrompt: "",
        },
        {
          title: "Analyze framework A",
          details: "Analyze shortlisted framework A",
          dependsOn: [2],
          onDependencyFailure: "skip",
          dependencyFailurePrompt: "",
        },
        {
          title: "Generate framework A diagram",
          details: "Generate framework A diagram",
          dependsOn: [3],
          onDependencyFailure: "skip",
          dependencyFailurePrompt: "",
        },
        {
          title: "Save framework A result",
          details: "Save framework A result",
          dependsOn: [4],
          onDependencyFailure: "skip",
          dependencyFailurePrompt: "",
        },
        {
          title: "Analyze framework B",
          details: "Analyze shortlisted framework B",
          dependsOn: [2],
          onDependencyFailure: "skip",
          dependencyFailurePrompt: "",
        },
        {
          title: "Generate framework B diagram",
          details: "Generate framework B diagram",
          dependsOn: [6],
          onDependencyFailure: "skip",
          dependencyFailurePrompt: "",
        },
        {
          title: "Save framework B result",
          details: "Save framework B result",
          dependsOn: [7],
          onDependencyFailure: "skip",
          dependencyFailurePrompt: "",
        },
      ],
    }),
  ];

  const agent = new CodexMainAgent({
    codexClient: {
      startThread() {
        return {
          async run(prompt) {
            prompts.push(prompt);
            return { finalResponse: responses.shift() };
          },
        };
      },
    },
  });

  const analysis = await agent.analyzeTodo("Research popular frameworks, shortlist top two frameworks, and generate a diagram for each framework.");

  assert.equal(prompts.length, 2);
  assert.equal(analysis.needsClarification, false);
  assert.equal(analysis.tasks[1].title, "Shortlist top two frameworks");
});

test("CodexMainAgent ignores unrelated English output counts when validating shortlist size", async () => {
  const prompts = [];
  const agent = new CodexMainAgent({
    codexClient: {
      startThread() {
        return {
          async run(prompt) {
            prompts.push(prompt);
            return {
              finalResponse: JSON.stringify({
                summary: "I interpreted your request as 9 tasks.",
                needsClarification: false,
                clarificationPrompt: "",
                tasks: [
                  {
                    title: "Research popular frameworks",
                    details: "Research popular frameworks",
                    dependsOn: [],
                    onDependencyFailure: "ask_user",
                    dependencyFailurePrompt: "",
                  },
                  {
                    title: "Shortlist Top 3 frameworks",
                    details: "Shortlist Top 3 frameworks",
                    dependsOn: [1],
                    onDependencyFailure: "abort",
                    dependencyFailurePrompt: "",
                  },
                  {
                    title: "Analyze framework A",
                    details: "Analyze shortlisted framework A",
                    dependsOn: [2],
                    onDependencyFailure: "skip",
                    dependencyFailurePrompt: "",
                  },
                  {
                    title: "Generate framework A diagram",
                    details: "Generate framework A diagram",
                    dependsOn: [3],
                    onDependencyFailure: "skip",
                    dependencyFailurePrompt: "",
                  },
                  {
                    title: "Analyze framework B",
                    details: "Analyze shortlisted framework B",
                    dependsOn: [2],
                    onDependencyFailure: "skip",
                    dependencyFailurePrompt: "",
                  },
                  {
                    title: "Generate framework B diagram",
                    details: "Generate framework B diagram",
                    dependsOn: [5],
                    onDependencyFailure: "skip",
                    dependencyFailurePrompt: "",
                  },
                  {
                    title: "Analyze framework C",
                    details: "Analyze shortlisted framework C",
                    dependsOn: [2],
                    onDependencyFailure: "skip",
                    dependencyFailurePrompt: "",
                  },
                  {
                    title: "Generate framework C diagram",
                    details: "Generate framework C diagram",
                    dependsOn: [7],
                    onDependencyFailure: "skip",
                    dependencyFailurePrompt: "",
                  },
                  {
                    title: "Write two markdown files",
                    details: "Write two markdown files with the final results",
                    dependsOn: [4, 6, 8],
                    onDependencyFailure: "skip",
                    dependencyFailurePrompt: "",
                  },
                ],
              }),
            };
          },
        };
      },
    },
  });

  const analysis = await agent.analyzeTodo("Research popular frameworks, generate a diagram for each framework, and write two markdown files with the results.");

  assert.equal(prompts.length, 1);
  assert.equal(analysis.needsClarification, false);
  assert.equal(analysis.tasks[1].title, "Shortlist Top 3 frameworks");
  assert.equal(analysis.tasks[8].title, "Write two markdown files");
});

test("CodexMainAgent retries when an English ordinal quantity is not reflected in the shortlist", async () => {
  const prompts = [];
  const responses = [
    JSON.stringify({
      summary: "I interpreted your request as 11 tasks.",
      needsClarification: false,
      clarificationPrompt: "",
      tasks: [
        {
          title: "Research popular frameworks",
          details: "Research popular frameworks",
          dependsOn: [],
          onDependencyFailure: "ask_user",
          dependencyFailurePrompt: "",
        },
        {
          title: "Shortlist Top 3 frameworks",
          details: "Shortlist Top 3 frameworks",
          dependsOn: [1],
          onDependencyFailure: "abort",
          dependencyFailurePrompt: "",
        },
        {
          title: "Analyze framework A",
          details: "Analyze shortlisted framework A",
          dependsOn: [2],
          onDependencyFailure: "skip",
          dependencyFailurePrompt: "",
        },
        {
          title: "Generate framework A diagram",
          details: "Generate framework A diagram",
          dependsOn: [3],
          onDependencyFailure: "skip",
          dependencyFailurePrompt: "",
        },
        {
          title: "Save framework A result",
          details: "Save framework A result",
          dependsOn: [4],
          onDependencyFailure: "skip",
          dependencyFailurePrompt: "",
        },
        {
          title: "Analyze framework B",
          details: "Analyze shortlisted framework B",
          dependsOn: [2],
          onDependencyFailure: "skip",
          dependencyFailurePrompt: "",
        },
        {
          title: "Generate framework B diagram",
          details: "Generate framework B diagram",
          dependsOn: [6],
          onDependencyFailure: "skip",
          dependencyFailurePrompt: "",
        },
        {
          title: "Save framework B result",
          details: "Save framework B result",
          dependsOn: [7],
          onDependencyFailure: "skip",
          dependencyFailurePrompt: "",
        },
        {
          title: "Analyze framework C",
          details: "Analyze shortlisted framework C",
          dependsOn: [2],
          onDependencyFailure: "skip",
          dependencyFailurePrompt: "",
        },
        {
          title: "Generate framework C diagram",
          details: "Generate framework C diagram",
          dependsOn: [9],
          onDependencyFailure: "skip",
          dependencyFailurePrompt: "",
        },
        {
          title: "Save framework C result",
          details: "Save framework C result",
          dependsOn: [10],
          onDependencyFailure: "skip",
          dependencyFailurePrompt: "",
        },
      ],
    }),
    JSON.stringify({
      summary: "I interpreted your request as 8 tasks.",
      needsClarification: false,
      clarificationPrompt: "",
      tasks: [
        {
          title: "Research popular frameworks",
          details: "Research popular frameworks",
          dependsOn: [],
          onDependencyFailure: "ask_user",
          dependencyFailurePrompt: "",
        },
        {
          title: "Shortlist the first two frameworks",
          details: "Shortlist the first two frameworks",
          dependsOn: [1],
          onDependencyFailure: "abort",
          dependencyFailurePrompt: "",
        },
        {
          title: "Analyze framework A",
          details: "Analyze shortlisted framework A",
          dependsOn: [2],
          onDependencyFailure: "skip",
          dependencyFailurePrompt: "",
        },
        {
          title: "Generate framework A diagram",
          details: "Generate framework A diagram",
          dependsOn: [3],
          onDependencyFailure: "skip",
          dependencyFailurePrompt: "",
        },
        {
          title: "Save framework A result",
          details: "Save framework A result",
          dependsOn: [4],
          onDependencyFailure: "skip",
          dependencyFailurePrompt: "",
        },
        {
          title: "Analyze framework B",
          details: "Analyze shortlisted framework B",
          dependsOn: [2],
          onDependencyFailure: "skip",
          dependencyFailurePrompt: "",
        },
        {
          title: "Generate framework B diagram",
          details: "Generate framework B diagram",
          dependsOn: [6],
          onDependencyFailure: "skip",
          dependencyFailurePrompt: "",
        },
        {
          title: "Save framework B result",
          details: "Save framework B result",
          dependsOn: [7],
          onDependencyFailure: "skip",
          dependencyFailurePrompt: "",
        },
      ],
    }),
  ];

  const agent = new CodexMainAgent({
    codexClient: {
      startThread() {
        return {
          async run(prompt) {
            prompts.push(prompt);
            return { finalResponse: responses.shift() };
          },
        };
      },
    },
  });

  const analysis = await agent.analyzeTodo("Research popular frameworks, shortlist the first two frameworks, and generate a diagram for each framework.");

  assert.equal(prompts.length, 2);
  assert.equal(analysis.needsClarification, false);
  assert.equal(analysis.tasks[1].title, "Shortlist the first two frameworks");
});

test("CodexMainAgent accepts shortlist plans that use 'both frameworks' without forcing retry", async () => {
  const prompts = [];
  const agent = new CodexMainAgent({
    codexClient: {
      startThread() {
        return {
          async run(prompt) {
            prompts.push(prompt);
            return {
              finalResponse: JSON.stringify({
                summary: "I interpreted your request as 8 tasks.",
                needsClarification: false,
                clarificationPrompt: "",
                tasks: [
                  {
                    title: "Research popular frameworks",
                    details: "Research popular frameworks",
                    dependsOn: [],
                    onDependencyFailure: "ask_user",
                    dependencyFailurePrompt: "",
                  },
                  {
                    title: "Shortlist both frameworks",
                    details: "Shortlist both frameworks from the research results",
                    dependsOn: [1],
                    onDependencyFailure: "abort",
                    dependencyFailurePrompt: "",
                  },
                  {
                    title: "Analyze framework A",
                    details: "Analyze shortlisted framework A",
                    dependsOn: [2],
                    onDependencyFailure: "skip",
                    dependencyFailurePrompt: "",
                  },
                  {
                    title: "Generate framework A diagram",
                    details: "Generate framework A diagram",
                    dependsOn: [3],
                    onDependencyFailure: "skip",
                    dependencyFailurePrompt: "",
                  },
                  {
                    title: "Save framework A result",
                    details: "Save framework A result",
                    dependsOn: [4],
                    onDependencyFailure: "skip",
                    dependencyFailurePrompt: "",
                  },
                  {
                    title: "Analyze framework B",
                    details: "Analyze shortlisted framework B",
                    dependsOn: [2],
                    onDependencyFailure: "skip",
                    dependencyFailurePrompt: "",
                  },
                  {
                    title: "Generate framework B diagram",
                    details: "Generate framework B diagram",
                    dependsOn: [6],
                    onDependencyFailure: "skip",
                    dependencyFailurePrompt: "",
                  },
                  {
                    title: "Save framework B result",
                    details: "Save framework B result",
                    dependsOn: [7],
                    onDependencyFailure: "skip",
                    dependencyFailurePrompt: "",
                  },
                ],
              }),
            };
          },
        };
      },
    },
  });

  const analysis = await agent.analyzeTodo("Research frameworks, shortlist both frameworks, and generate a diagram for each framework.");

  assert.equal(prompts.length, 1);
  assert.equal(analysis.needsClarification, false);
  assert.equal(analysis.tasks[1].title, "Shortlist both frameworks");
});

test("CodexMainAgent retries when 'both frameworks' is not reflected in the shortlist size", async () => {
  const prompts = [];
  const responses = [
    JSON.stringify({
      summary: "I interpreted your request as 11 tasks.",
      needsClarification: false,
      clarificationPrompt: "",
      tasks: [
        {
          title: "Research frameworks",
          details: "Research frameworks",
          dependsOn: [],
          onDependencyFailure: "ask_user",
          dependencyFailurePrompt: "",
        },
        {
          title: "Shortlist Top 3 frameworks",
          details: "Shortlist Top 3 frameworks",
          dependsOn: [1],
          onDependencyFailure: "abort",
          dependencyFailurePrompt: "",
        },
        {
          title: "Analyze framework A",
          details: "Analyze shortlisted framework A",
          dependsOn: [2],
          onDependencyFailure: "skip",
          dependencyFailurePrompt: "",
        },
        {
          title: "Generate framework A diagram",
          details: "Generate framework A diagram",
          dependsOn: [3],
          onDependencyFailure: "skip",
          dependencyFailurePrompt: "",
        },
        {
          title: "Save framework A result",
          details: "Save framework A result",
          dependsOn: [4],
          onDependencyFailure: "skip",
          dependencyFailurePrompt: "",
        },
        {
          title: "Analyze framework B",
          details: "Analyze shortlisted framework B",
          dependsOn: [2],
          onDependencyFailure: "skip",
          dependencyFailurePrompt: "",
        },
        {
          title: "Generate framework B diagram",
          details: "Generate framework B diagram",
          dependsOn: [6],
          onDependencyFailure: "skip",
          dependencyFailurePrompt: "",
        },
        {
          title: "Save framework B result",
          details: "Save framework B result",
          dependsOn: [7],
          onDependencyFailure: "skip",
          dependencyFailurePrompt: "",
        },
        {
          title: "Analyze framework C",
          details: "Analyze shortlisted framework C",
          dependsOn: [2],
          onDependencyFailure: "skip",
          dependencyFailurePrompt: "",
        },
        {
          title: "Generate framework C diagram",
          details: "Generate framework C diagram",
          dependsOn: [9],
          onDependencyFailure: "skip",
          dependencyFailurePrompt: "",
        },
        {
          title: "Save framework C result",
          details: "Save framework C result",
          dependsOn: [10],
          onDependencyFailure: "skip",
          dependencyFailurePrompt: "",
        },
      ],
    }),
    JSON.stringify({
      summary: "I interpreted your request as 8 tasks.",
      needsClarification: false,
      clarificationPrompt: "",
      tasks: [
        {
          title: "Research frameworks",
          details: "Research frameworks",
          dependsOn: [],
          onDependencyFailure: "ask_user",
          dependencyFailurePrompt: "",
        },
        {
          title: "Shortlist both frameworks",
          details: "Shortlist both frameworks",
          dependsOn: [1],
          onDependencyFailure: "abort",
          dependencyFailurePrompt: "",
        },
        {
          title: "Analyze framework A",
          details: "Analyze shortlisted framework A",
          dependsOn: [2],
          onDependencyFailure: "skip",
          dependencyFailurePrompt: "",
        },
        {
          title: "Generate framework A diagram",
          details: "Generate framework A diagram",
          dependsOn: [3],
          onDependencyFailure: "skip",
          dependencyFailurePrompt: "",
        },
        {
          title: "Save framework A result",
          details: "Save framework A result",
          dependsOn: [4],
          onDependencyFailure: "skip",
          dependencyFailurePrompt: "",
        },
        {
          title: "Analyze framework B",
          details: "Analyze shortlisted framework B",
          dependsOn: [2],
          onDependencyFailure: "skip",
          dependencyFailurePrompt: "",
        },
        {
          title: "Generate framework B diagram",
          details: "Generate framework B diagram",
          dependsOn: [6],
          onDependencyFailure: "skip",
          dependencyFailurePrompt: "",
        },
        {
          title: "Save framework B result",
          details: "Save framework B result",
          dependsOn: [7],
          onDependencyFailure: "skip",
          dependencyFailurePrompt: "",
        },
      ],
    }),
  ];

  const agent = new CodexMainAgent({
    codexClient: {
      startThread() {
        return {
          async run(prompt) {
            prompts.push(prompt);
            return { finalResponse: responses.shift() };
          },
        };
      },
    },
  });

  const analysis = await agent.analyzeTodo("Research frameworks, shortlist both frameworks, and generate a diagram for each framework.");

  assert.equal(prompts.length, 2);
  assert.equal(analysis.needsClarification, false);
  assert.equal(analysis.tasks[1].title, "Shortlist both frameworks");
});

test("CodexMainAgent retries when model entity counts are not reflected in the shortlist size", async () => {
  const prompts = [];
  const responses = [
    JSON.stringify({
      summary: "I interpreted your request as 11 tasks.",
      needsClarification: false,
      clarificationPrompt: "",
      tasks: [
        { title: "Research popular models", details: "Research popular models", dependsOn: [], onDependencyFailure: "ask_user", dependencyFailurePrompt: "" },
        { title: "Shortlist Top 3 models", details: "Shortlist Top 3 models", dependsOn: [1], onDependencyFailure: "abort", dependencyFailurePrompt: "" },
        { title: "Analyze model A", details: "Analyze shortlisted model A", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate model A diagram", details: "Generate model A diagram", dependsOn: [3], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save model A result", details: "Save model A result", dependsOn: [4], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Analyze model B", details: "Analyze shortlisted model B", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate model B diagram", details: "Generate model B diagram", dependsOn: [6], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save model B result", details: "Save model B result", dependsOn: [7], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Analyze model C", details: "Analyze shortlisted model C", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate model C diagram", details: "Generate model C diagram", dependsOn: [9], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save model C result", details: "Save model C result", dependsOn: [10], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
      ],
    }),
    JSON.stringify({
      summary: "I interpreted your request as 8 tasks.",
      needsClarification: false,
      clarificationPrompt: "",
      tasks: [
        { title: "Research popular models", details: "Research popular models", dependsOn: [], onDependencyFailure: "ask_user", dependencyFailurePrompt: "" },
        { title: "Shortlist top two models", details: "Shortlist top two models", dependsOn: [1], onDependencyFailure: "abort", dependencyFailurePrompt: "" },
        { title: "Analyze model A", details: "Analyze shortlisted model A", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate model A diagram", details: "Generate model A diagram", dependsOn: [3], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save model A result", details: "Save model A result", dependsOn: [4], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Analyze model B", details: "Analyze shortlisted model B", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate model B diagram", details: "Generate model B diagram", dependsOn: [6], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save model B result", details: "Save model B result", dependsOn: [7], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
      ],
    }),
  ];

  const agent = new CodexMainAgent({
    codexClient: {
      startThread() {
        return {
          async run(prompt) {
            prompts.push(prompt);
            return { finalResponse: responses.shift() };
          },
        };
      },
    },
  });

  const analysis = await agent.analyzeTodo("Research popular models, shortlist top two models, and generate a diagram for each model.");

  assert.equal(prompts.length, 2);
  assert.equal(analysis.needsClarification, false);
  assert.equal(analysis.tasks[1].title, "Shortlist top two models");
});

test("CodexMainAgent retries when service entity counts are not reflected in the shortlist size", async () => {
  const prompts = [];
  const responses = [
    JSON.stringify({
      summary: "I interpreted your request as 11 tasks.",
      needsClarification: false,
      clarificationPrompt: "",
      tasks: [
        { title: "Research candidate services", details: "Research candidate services", dependsOn: [], onDependencyFailure: "ask_user", dependencyFailurePrompt: "" },
        { title: "Shortlist Top 3 services", details: "Shortlist Top 3 services", dependsOn: [1], onDependencyFailure: "abort", dependencyFailurePrompt: "" },
        { title: "Analyze service A", details: "Analyze shortlisted service A", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate service A diagram", details: "Generate service A diagram", dependsOn: [3], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save service A result", details: "Save service A result", dependsOn: [4], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Analyze service B", details: "Analyze shortlisted service B", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate service B diagram", details: "Generate service B diagram", dependsOn: [6], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save service B result", details: "Save service B result", dependsOn: [7], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Analyze service C", details: "Analyze shortlisted service C", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate service C diagram", details: "Generate service C diagram", dependsOn: [9], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save service C result", details: "Save service C result", dependsOn: [10], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
      ],
    }),
    JSON.stringify({
      summary: "I interpreted your request as 8 tasks.",
      needsClarification: false,
      clarificationPrompt: "",
      tasks: [
        { title: "Research candidate services", details: "Research candidate services", dependsOn: [], onDependencyFailure: "ask_user", dependencyFailurePrompt: "" },
        { title: "Shortlist both services", details: "Shortlist both services", dependsOn: [1], onDependencyFailure: "abort", dependencyFailurePrompt: "" },
        { title: "Analyze service A", details: "Analyze shortlisted service A", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate service A diagram", details: "Generate service A diagram", dependsOn: [3], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save service A result", details: "Save service A result", dependsOn: [4], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Analyze service B", details: "Analyze shortlisted service B", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate service B diagram", details: "Generate service B diagram", dependsOn: [6], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save service B result", details: "Save service B result", dependsOn: [7], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
      ],
    }),
  ];

  const agent = new CodexMainAgent({
    codexClient: {
      startThread() {
        return {
          async run(prompt) {
            prompts.push(prompt);
            return { finalResponse: responses.shift() };
          },
        };
      },
    },
  });

  const analysis = await agent.analyzeTodo("Research candidate services, shortlist both services, and generate a diagram for each service.");

  assert.equal(prompts.length, 2);
  assert.equal(analysis.needsClarification, false);
  assert.equal(analysis.tasks[1].title, "Shortlist both services");
});

test("CodexMainAgent retries when repo entity counts are not reflected in the shortlist size", async () => {
  const prompts = [];
  const responses = [
    JSON.stringify({
      summary: "I interpreted your request as 11 tasks.",
      needsClarification: false,
      clarificationPrompt: "",
      tasks: [
        { title: "Research candidate repos", details: "Research candidate repos", dependsOn: [], onDependencyFailure: "ask_user", dependencyFailurePrompt: "" },
        { title: "Shortlist Top 3 repos", details: "Shortlist Top 3 repos", dependsOn: [1], onDependencyFailure: "abort", dependencyFailurePrompt: "" },
        { title: "Analyze repo A", details: "Analyze shortlisted repo A", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate repo A diagram", details: "Generate repo A diagram", dependsOn: [3], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save repo A result", details: "Save repo A result", dependsOn: [4], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Analyze repo B", details: "Analyze shortlisted repo B", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate repo B diagram", details: "Generate repo B diagram", dependsOn: [6], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save repo B result", details: "Save repo B result", dependsOn: [7], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Analyze repo C", details: "Analyze shortlisted repo C", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate repo C diagram", details: "Generate repo C diagram", dependsOn: [9], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save repo C result", details: "Save repo C result", dependsOn: [10], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
      ],
    }),
    JSON.stringify({
      summary: "I interpreted your request as 8 tasks.",
      needsClarification: false,
      clarificationPrompt: "",
      tasks: [
        { title: "Research candidate repos", details: "Research candidate repos", dependsOn: [], onDependencyFailure: "ask_user", dependencyFailurePrompt: "" },
        { title: "Shortlist top two repos", details: "Shortlist top two repos", dependsOn: [1], onDependencyFailure: "abort", dependencyFailurePrompt: "" },
        { title: "Analyze repo A", details: "Analyze shortlisted repo A", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate repo A diagram", details: "Generate repo A diagram", dependsOn: [3], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save repo A result", details: "Save repo A result", dependsOn: [4], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Analyze repo B", details: "Analyze shortlisted repo B", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate repo B diagram", details: "Generate repo B diagram", dependsOn: [6], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save repo B result", details: "Save repo B result", dependsOn: [7], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
      ],
    }),
  ];

  const agent = new CodexMainAgent({
    codexClient: {
      startThread() {
        return {
          async run(prompt) {
            prompts.push(prompt);
            return { finalResponse: responses.shift() };
          },
        };
      },
    },
  });

  const analysis = await agent.analyzeTodo("Research candidate repos, shortlist top two repos, and generate a diagram for each repo.");

  assert.equal(prompts.length, 2);
  assert.equal(analysis.needsClarification, false);
  assert.equal(analysis.tasks[1].title, "Shortlist top two repos");
});

test("CodexMainAgent retries when dataset entity counts are not reflected in the shortlist size", async () => {
  const prompts = [];
  const responses = [
    JSON.stringify({
      summary: "I interpreted your request as 11 tasks.",
      needsClarification: false,
      clarificationPrompt: "",
      tasks: [
        { title: "Research candidate datasets", details: "Research candidate datasets", dependsOn: [], onDependencyFailure: "ask_user", dependencyFailurePrompt: "" },
        { title: "Shortlist Top 3 datasets", details: "Shortlist Top 3 datasets", dependsOn: [1], onDependencyFailure: "abort", dependencyFailurePrompt: "" },
        { title: "Analyze dataset A", details: "Analyze shortlisted dataset A", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate dataset A diagram", details: "Generate dataset A diagram", dependsOn: [3], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save dataset A result", details: "Save dataset A result", dependsOn: [4], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Analyze dataset B", details: "Analyze shortlisted dataset B", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate dataset B diagram", details: "Generate dataset B diagram", dependsOn: [6], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save dataset B result", details: "Save dataset B result", dependsOn: [7], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Analyze dataset C", details: "Analyze shortlisted dataset C", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate dataset C diagram", details: "Generate dataset C diagram", dependsOn: [9], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save dataset C result", details: "Save dataset C result", dependsOn: [10], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
      ],
    }),
    JSON.stringify({
      summary: "I interpreted your request as 8 tasks.",
      needsClarification: false,
      clarificationPrompt: "",
      tasks: [
        { title: "Research candidate datasets", details: "Research candidate datasets", dependsOn: [], onDependencyFailure: "ask_user", dependencyFailurePrompt: "" },
        { title: "Shortlist both datasets", details: "Shortlist both datasets", dependsOn: [1], onDependencyFailure: "abort", dependencyFailurePrompt: "" },
        { title: "Analyze dataset A", details: "Analyze shortlisted dataset A", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate dataset A diagram", details: "Generate dataset A diagram", dependsOn: [3], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save dataset A result", details: "Save dataset A result", dependsOn: [4], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Analyze dataset B", details: "Analyze shortlisted dataset B", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate dataset B diagram", details: "Generate dataset B diagram", dependsOn: [6], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save dataset B result", details: "Save dataset B result", dependsOn: [7], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
      ],
    }),
  ];

  const agent = new CodexMainAgent({
    codexClient: {
      startThread() {
        return {
          async run(prompt) {
            prompts.push(prompt);
            return { finalResponse: responses.shift() };
          },
        };
      },
    },
  });

  const analysis = await agent.analyzeTodo("Research candidate datasets, shortlist both datasets, and generate a diagram for each dataset.");

  assert.equal(prompts.length, 2);
  assert.equal(analysis.needsClarification, false);
  assert.equal(analysis.tasks[1].title, "Shortlist both datasets");
});

test("CodexMainAgent retries when api entity counts are not reflected in the shortlist size", async () => {
  const prompts = [];
  const responses = [
    JSON.stringify({
      summary: "I interpreted your request as 11 tasks.",
      needsClarification: false,
      clarificationPrompt: "",
      tasks: [
        { title: "Research candidate APIs", details: "Research candidate APIs", dependsOn: [], onDependencyFailure: "ask_user", dependencyFailurePrompt: "" },
        { title: "Shortlist Top 3 APIs", details: "Shortlist Top 3 APIs", dependsOn: [1], onDependencyFailure: "abort", dependencyFailurePrompt: "" },
        { title: "Analyze API A", details: "Analyze shortlisted API A", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate API A diagram", details: "Generate API A diagram", dependsOn: [3], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save API A result", details: "Save API A result", dependsOn: [4], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Analyze API B", details: "Analyze shortlisted API B", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate API B diagram", details: "Generate API B diagram", dependsOn: [6], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save API B result", details: "Save API B result", dependsOn: [7], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Analyze API C", details: "Analyze shortlisted API C", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate API C diagram", details: "Generate API C diagram", dependsOn: [9], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save API C result", details: "Save API C result", dependsOn: [10], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
      ],
    }),
    JSON.stringify({
      summary: "I interpreted your request as 8 tasks.",
      needsClarification: false,
      clarificationPrompt: "",
      tasks: [
        { title: "Research candidate APIs", details: "Research candidate APIs", dependsOn: [], onDependencyFailure: "ask_user", dependencyFailurePrompt: "" },
        { title: "Shortlist first two APIs", details: "Shortlist first two APIs", dependsOn: [1], onDependencyFailure: "abort", dependencyFailurePrompt: "" },
        { title: "Analyze API A", details: "Analyze shortlisted API A", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate API A diagram", details: "Generate API A diagram", dependsOn: [3], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save API A result", details: "Save API A result", dependsOn: [4], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Analyze API B", details: "Analyze shortlisted API B", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate API B diagram", details: "Generate API B diagram", dependsOn: [6], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save API B result", details: "Save API B result", dependsOn: [7], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
      ],
    }),
  ];

  const agent = new CodexMainAgent({
    codexClient: {
      startThread() {
        return {
          async run(prompt) {
            prompts.push(prompt);
            return { finalResponse: responses.shift() };
          },
        };
      },
    },
  });

  const analysis = await agent.analyzeTodo("Research candidate APIs, shortlist first two APIs, and generate a diagram for each API.");

  assert.equal(prompts.length, 2);
  assert.equal(analysis.needsClarification, false);
  assert.equal(analysis.tasks[1].title, "Shortlist first two APIs");
});

test("CodexMainAgent retries when a direct entity count is not reflected in the shortlist size", async () => {
  const prompts = [];
  const responses = [
    JSON.stringify({
      summary: "I interpreted your request as 11 tasks.",
      needsClarification: false,
      clarificationPrompt: "",
      tasks: [
        { title: "Research candidate frameworks", details: "Research candidate frameworks", dependsOn: [], onDependencyFailure: "ask_user", dependencyFailurePrompt: "" },
        { title: "Shortlist Top 3 frameworks", details: "Shortlist Top 3 frameworks", dependsOn: [1], onDependencyFailure: "abort", dependencyFailurePrompt: "" },
        { title: "Analyze framework A", details: "Analyze shortlisted framework A", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate framework A diagram", details: "Generate framework A diagram", dependsOn: [3], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save framework A result", details: "Save framework A result", dependsOn: [4], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Analyze framework B", details: "Analyze shortlisted framework B", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate framework B diagram", details: "Generate framework B diagram", dependsOn: [6], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save framework B result", details: "Save framework B result", dependsOn: [7], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Analyze framework C", details: "Analyze shortlisted framework C", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate framework C diagram", details: "Generate framework C diagram", dependsOn: [9], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save framework C result", details: "Save framework C result", dependsOn: [10], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
      ],
    }),
    JSON.stringify({
      summary: "I interpreted your request as 8 tasks.",
      needsClarification: false,
      clarificationPrompt: "",
      tasks: [
        { title: "Research candidate frameworks", details: "Research candidate frameworks", dependsOn: [], onDependencyFailure: "ask_user", dependencyFailurePrompt: "" },
        { title: "Shortlist 2 frameworks", details: "Shortlist 2 frameworks", dependsOn: [1], onDependencyFailure: "abort", dependencyFailurePrompt: "" },
        { title: "Analyze framework A", details: "Analyze shortlisted framework A", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate framework A diagram", details: "Generate framework A diagram", dependsOn: [3], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save framework A result", details: "Save framework A result", dependsOn: [4], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Analyze framework B", details: "Analyze shortlisted framework B", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate framework B diagram", details: "Generate framework B diagram", dependsOn: [6], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save framework B result", details: "Save framework B result", dependsOn: [7], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
      ],
    }),
  ];

  const agent = new CodexMainAgent({
    codexClient: {
      startThread() {
        return {
          async run(prompt) {
            prompts.push(prompt);
            return { finalResponse: responses.shift() };
          },
        };
      },
    },
  });

  const analysis = await agent.analyzeTodo("Research 2 frameworks and generate a diagram for each framework.");

  assert.equal(prompts.length, 2);
  assert.equal(analysis.needsClarification, false);
  assert.equal(analysis.tasks[1].title, "Shortlist 2 frameworks");
});

test("CodexMainAgent retries when a direct entity count is paired with 'each one'", async () => {
  const prompts = [];
  const responses = [
    JSON.stringify({
      summary: "I interpreted your request as 11 tasks.",
      needsClarification: false,
      clarificationPrompt: "",
      tasks: [
        { title: "Research candidate frameworks", details: "Research candidate frameworks", dependsOn: [], onDependencyFailure: "ask_user", dependencyFailurePrompt: "" },
        { title: "Shortlist Top 3 frameworks", details: "Shortlist Top 3 frameworks", dependsOn: [1], onDependencyFailure: "abort", dependencyFailurePrompt: "" },
        { title: "Analyze framework A", details: "Analyze shortlisted framework A", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate framework A diagram", details: "Generate framework A diagram", dependsOn: [3], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save framework A result", details: "Save framework A result", dependsOn: [4], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Analyze framework B", details: "Analyze shortlisted framework B", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate framework B diagram", details: "Generate framework B diagram", dependsOn: [6], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save framework B result", details: "Save framework B result", dependsOn: [7], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Analyze framework C", details: "Analyze shortlisted framework C", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate framework C diagram", details: "Generate framework C diagram", dependsOn: [9], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save framework C result", details: "Save framework C result", dependsOn: [10], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
      ],
    }),
    JSON.stringify({
      summary: "I interpreted your request as 8 tasks.",
      needsClarification: false,
      clarificationPrompt: "",
      tasks: [
        { title: "Research candidate frameworks", details: "Research candidate frameworks", dependsOn: [], onDependencyFailure: "ask_user", dependencyFailurePrompt: "" },
        { title: "Shortlist 2 frameworks", details: "Shortlist 2 frameworks", dependsOn: [1], onDependencyFailure: "abort", dependencyFailurePrompt: "" },
        { title: "Analyze framework A", details: "Analyze shortlisted framework A", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate framework A diagram", details: "Generate framework A diagram", dependsOn: [3], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save framework A result", details: "Save framework A result", dependsOn: [4], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Analyze framework B", details: "Analyze shortlisted framework B", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate framework B diagram", details: "Generate framework B diagram", dependsOn: [6], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save framework B result", details: "Save framework B result", dependsOn: [7], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
      ],
    }),
  ];

  const agent = new CodexMainAgent({
    codexClient: {
      startThread() {
        return {
          async run(prompt) {
            prompts.push(prompt);
            return { finalResponse: responses.shift() };
          },
        };
      },
    },
  });

  const analysis = await agent.analyzeTodo("Research 2 frameworks and generate a diagram for each one.");

  assert.equal(prompts.length, 2);
  assert.equal(analysis.needsClarification, false);
  assert.equal(analysis.tasks[1].title, "Shortlist 2 frameworks");
});

test("CodexMainAgent retries when a direct entity count is paired with 'both of them'", async () => {
  const prompts = [];
  const responses = [
    JSON.stringify({
      summary: "I interpreted your request as 11 tasks.",
      needsClarification: false,
      clarificationPrompt: "",
      tasks: [
        { title: "Research candidate frameworks", details: "Research candidate frameworks", dependsOn: [], onDependencyFailure: "ask_user", dependencyFailurePrompt: "" },
        { title: "Shortlist Top 3 frameworks", details: "Shortlist Top 3 frameworks", dependsOn: [1], onDependencyFailure: "abort", dependencyFailurePrompt: "" },
        { title: "Analyze framework A", details: "Analyze shortlisted framework A", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate framework A diagram", details: "Generate framework A diagram", dependsOn: [3], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save framework A result", details: "Save framework A result", dependsOn: [4], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Analyze framework B", details: "Analyze shortlisted framework B", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate framework B diagram", details: "Generate framework B diagram", dependsOn: [6], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save framework B result", details: "Save framework B result", dependsOn: [7], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Analyze framework C", details: "Analyze shortlisted framework C", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate framework C diagram", details: "Generate framework C diagram", dependsOn: [9], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save framework C result", details: "Save framework C result", dependsOn: [10], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
      ],
    }),
    JSON.stringify({
      summary: "I interpreted your request as 8 tasks.",
      needsClarification: false,
      clarificationPrompt: "",
      tasks: [
        { title: "Research candidate frameworks", details: "Research candidate frameworks", dependsOn: [], onDependencyFailure: "ask_user", dependencyFailurePrompt: "" },
        { title: "Shortlist 2 frameworks", details: "Shortlist 2 frameworks", dependsOn: [1], onDependencyFailure: "abort", dependencyFailurePrompt: "" },
        { title: "Analyze framework A", details: "Analyze shortlisted framework A", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate framework A diagram", details: "Generate framework A diagram", dependsOn: [3], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save framework A result", details: "Save framework A result", dependsOn: [4], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Analyze framework B", details: "Analyze shortlisted framework B", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate framework B diagram", details: "Generate framework B diagram", dependsOn: [6], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save framework B result", details: "Save framework B result", dependsOn: [7], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
      ],
    }),
  ];

  const agent = new CodexMainAgent({
    codexClient: {
      startThread() {
        return {
          async run(prompt) {
            prompts.push(prompt);
            return { finalResponse: responses.shift() };
          },
        };
      },
    },
  });

  const analysis = await agent.analyzeTodo("Research 2 frameworks and generate diagrams for both of them.");

  assert.equal(prompts.length, 2);
  assert.equal(analysis.needsClarification, false);
  assert.equal(analysis.tasks[1].title, "Shortlist 2 frameworks");
});

test("CodexMainAgent retries when a Chinese direct entity count is paired with '给这两个分别生成'", async () => {
  const prompts = [];
  const responses = [
    JSON.stringify({
      summary: "I interpreted your request as 11 tasks.",
      needsClarification: false,
      clarificationPrompt: "",
      tasks: [
        { title: "调研候选框架", details: "调研候选框架", dependsOn: [], onDependencyFailure: "ask_user", dependencyFailurePrompt: "" },
        { title: "筛选 Top 3 框架", details: "筛选 Top 3 框架", dependsOn: [1], onDependencyFailure: "abort", dependencyFailurePrompt: "" },
        { title: "分析框架 A", details: "分析 shortlisted 框架 A", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "生成框架 A 架构图", details: "生成框架 A 架构图", dependsOn: [3], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "保存框架 A 结果", details: "保存框架 A 结果", dependsOn: [4], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "分析框架 B", details: "分析 shortlisted 框架 B", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "生成框架 B 架构图", details: "生成框架 B 架构图", dependsOn: [6], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "保存框架 B 结果", details: "保存框架 B 结果", dependsOn: [7], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "分析框架 C", details: "分析 shortlisted 框架 C", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "生成框架 C 架构图", details: "生成框架 C 架构图", dependsOn: [9], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "保存框架 C 结果", details: "保存框架 C 结果", dependsOn: [10], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
      ],
    }),
    JSON.stringify({
      summary: "I interpreted your request as 8 tasks.",
      needsClarification: false,
      clarificationPrompt: "",
      tasks: [
        { title: "调研候选框架", details: "调研候选框架", dependsOn: [], onDependencyFailure: "ask_user", dependencyFailurePrompt: "" },
        { title: "筛选两个框架", details: "筛选两个框架", dependsOn: [1], onDependencyFailure: "abort", dependencyFailurePrompt: "" },
        { title: "分析框架 A", details: "分析 shortlisted 框架 A", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "生成框架 A 架构图", details: "生成框架 A 架构图", dependsOn: [3], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "保存框架 A 结果", details: "保存框架 A 结果", dependsOn: [4], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "分析框架 B", details: "分析 shortlisted 框架 B", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "生成框架 B 架构图", details: "生成框架 B 架构图", dependsOn: [6], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "保存框架 B 结果", details: "保存框架 B 结果", dependsOn: [7], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
      ],
    }),
  ];

  const agent = new CodexMainAgent({
    codexClient: {
      startThread() {
        return {
          async run(prompt) {
            prompts.push(prompt);
            return { finalResponse: responses.shift() };
          },
        };
      },
    },
  });

  const analysis = await agent.analyzeTodo("调研两个框架，给这两个分别生成架构图并保存。");

  assert.equal(prompts.length, 2);
  assert.equal(analysis.needsClarification, false);
  assert.equal(analysis.tasks[1].title, "筛选两个框架");
});

test("CodexMainAgent retries when a Chinese direct entity count is paired with '给两者分别生成'", async () => {
  const prompts = [];
  const responses = [
    JSON.stringify({
      summary: "I interpreted your request as 11 tasks.",
      needsClarification: false,
      clarificationPrompt: "",
      tasks: [
        { title: "调研候选框架", details: "调研候选框架", dependsOn: [], onDependencyFailure: "ask_user", dependencyFailurePrompt: "" },
        { title: "筛选 Top 3 框架", details: "筛选 Top 3 框架", dependsOn: [1], onDependencyFailure: "abort", dependencyFailurePrompt: "" },
        { title: "分析框架 A", details: "分析 shortlisted 框架 A", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "生成框架 A 架构图", details: "生成框架 A 架构图", dependsOn: [3], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "保存框架 A 结果", details: "保存框架 A 结果", dependsOn: [4], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "分析框架 B", details: "分析 shortlisted 框架 B", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "生成框架 B 架构图", details: "生成框架 B 架构图", dependsOn: [6], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "保存框架 B 结果", details: "保存框架 B 结果", dependsOn: [7], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "分析框架 C", details: "分析 shortlisted 框架 C", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "生成框架 C 架构图", details: "生成框架 C 架构图", dependsOn: [9], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "保存框架 C 结果", details: "保存框架 C 结果", dependsOn: [10], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
      ],
    }),
    JSON.stringify({
      summary: "I interpreted your request as 8 tasks.",
      needsClarification: false,
      clarificationPrompt: "",
      tasks: [
        { title: "调研候选框架", details: "调研候选框架", dependsOn: [], onDependencyFailure: "ask_user", dependencyFailurePrompt: "" },
        { title: "筛选两个框架", details: "筛选两个框架", dependsOn: [1], onDependencyFailure: "abort", dependencyFailurePrompt: "" },
        { title: "分析框架 A", details: "分析 shortlisted 框架 A", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "生成框架 A 架构图", details: "生成框架 A 架构图", dependsOn: [3], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "保存框架 A 结果", details: "保存框架 A 结果", dependsOn: [4], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "分析框架 B", details: "分析 shortlisted 框架 B", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "生成框架 B 架构图", details: "生成框架 B 架构图", dependsOn: [6], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "保存框架 B 结果", details: "保存框架 B 结果", dependsOn: [7], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
      ],
    }),
  ];

  const agent = new CodexMainAgent({
    codexClient: {
      startThread() {
        return {
          async run(prompt) {
            prompts.push(prompt);
            return { finalResponse: responses.shift() };
          },
        };
      },
    },
  });

  const analysis = await agent.analyzeTodo("调研两个框架，给两者分别生成架构图并保存。");

  assert.equal(prompts.length, 2);
  assert.equal(analysis.needsClarification, false);
  assert.equal(analysis.tasks[1].title, "筛选两个框架");
});

test("CodexMainAgent retries when a direct entity count is paired with 'for the pair'", async () => {
  const prompts = [];
  const responses = [
    JSON.stringify({
      summary: "I interpreted your request as 11 tasks.",
      needsClarification: false,
      clarificationPrompt: "",
      tasks: [
        { title: "Research candidate frameworks", details: "Research candidate frameworks", dependsOn: [], onDependencyFailure: "ask_user", dependencyFailurePrompt: "" },
        { title: "Shortlist Top 3 frameworks", details: "Shortlist Top 3 frameworks", dependsOn: [1], onDependencyFailure: "abort", dependencyFailurePrompt: "" },
        { title: "Analyze framework A", details: "Analyze shortlisted framework A", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate framework A diagram", details: "Generate framework A diagram", dependsOn: [3], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save framework A result", details: "Save framework A result", dependsOn: [4], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Analyze framework B", details: "Analyze shortlisted framework B", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate framework B diagram", details: "Generate framework B diagram", dependsOn: [6], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save framework B result", details: "Save framework B result", dependsOn: [7], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Analyze framework C", details: "Analyze shortlisted framework C", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate framework C diagram", details: "Generate framework C diagram", dependsOn: [9], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save framework C result", details: "Save framework C result", dependsOn: [10], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
      ],
    }),
    JSON.stringify({
      summary: "I interpreted your request as 8 tasks.",
      needsClarification: false,
      clarificationPrompt: "",
      tasks: [
        { title: "Research candidate frameworks", details: "Research candidate frameworks", dependsOn: [], onDependencyFailure: "ask_user", dependencyFailurePrompt: "" },
        { title: "Shortlist 2 frameworks", details: "Shortlist 2 frameworks", dependsOn: [1], onDependencyFailure: "abort", dependencyFailurePrompt: "" },
        { title: "Analyze framework A", details: "Analyze shortlisted framework A", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate framework A diagram", details: "Generate framework A diagram", dependsOn: [3], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save framework A result", details: "Save framework A result", dependsOn: [4], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Analyze framework B", details: "Analyze shortlisted framework B", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate framework B diagram", details: "Generate framework B diagram", dependsOn: [6], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save framework B result", details: "Save framework B result", dependsOn: [7], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
      ],
    }),
  ];

  const agent = new CodexMainAgent({
    codexClient: {
      startThread() {
        return {
          async run(prompt) {
            prompts.push(prompt);
            return { finalResponse: responses.shift() };
          },
        };
      },
    },
  });

  const analysis = await agent.analyzeTodo("Research 2 frameworks and generate a diagram for the pair.");

  assert.equal(prompts.length, 2);
  assert.equal(analysis.needsClarification, false);
  assert.equal(analysis.tasks[1].title, "Shortlist 2 frameworks");
});

test("CodexMainAgent retries when a direct entity count is paired with 'for the duo'", async () => {
  const prompts = [];
  const responses = [
    JSON.stringify({
      summary: "I interpreted your request as 11 tasks.",
      needsClarification: false,
      clarificationPrompt: "",
      tasks: [
        { title: "Research candidate frameworks", details: "Research candidate frameworks", dependsOn: [], onDependencyFailure: "ask_user", dependencyFailurePrompt: "" },
        { title: "Shortlist Top 3 frameworks", details: "Shortlist Top 3 frameworks", dependsOn: [1], onDependencyFailure: "abort", dependencyFailurePrompt: "" },
        { title: "Analyze framework A", details: "Analyze shortlisted framework A", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate framework A diagram", details: "Generate framework A diagram", dependsOn: [3], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save framework A result", details: "Save framework A result", dependsOn: [4], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Analyze framework B", details: "Analyze shortlisted framework B", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate framework B diagram", details: "Generate framework B diagram", dependsOn: [6], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save framework B result", details: "Save framework B result", dependsOn: [7], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Analyze framework C", details: "Analyze shortlisted framework C", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate framework C diagram", details: "Generate framework C diagram", dependsOn: [9], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save framework C result", details: "Save framework C result", dependsOn: [10], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
      ],
    }),
    JSON.stringify({
      summary: "I interpreted your request as 8 tasks.",
      needsClarification: false,
      clarificationPrompt: "",
      tasks: [
        { title: "Research candidate frameworks", details: "Research candidate frameworks", dependsOn: [], onDependencyFailure: "ask_user", dependencyFailurePrompt: "" },
        { title: "Shortlist 2 frameworks", details: "Shortlist 2 frameworks", dependsOn: [1], onDependencyFailure: "abort", dependencyFailurePrompt: "" },
        { title: "Analyze framework A", details: "Analyze shortlisted framework A", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate framework A diagram", details: "Generate framework A diagram", dependsOn: [3], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save framework A result", details: "Save framework A result", dependsOn: [4], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Analyze framework B", details: "Analyze shortlisted framework B", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate framework B diagram", details: "Generate framework B diagram", dependsOn: [6], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save framework B result", details: "Save framework B result", dependsOn: [7], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
      ],
    }),
  ];

  const agent = new CodexMainAgent({
    codexClient: {
      startThread() {
        return {
          async run(prompt) {
            prompts.push(prompt);
            return { finalResponse: responses.shift() };
          },
        };
      },
    },
  });

  const analysis = await agent.analyzeTodo("Research 2 frameworks and generate a diagram for the duo.");

  assert.equal(prompts.length, 2);
  assert.equal(analysis.needsClarification, false);
  assert.equal(analysis.tasks[1].title, "Shortlist 2 frameworks");
});

test("CodexMainAgent retries when a Chinese direct entity count is paired with '给这俩分别生成'", async () => {
  const prompts = [];
  const responses = [
    JSON.stringify({
      summary: "I interpreted your request as 11 tasks.",
      needsClarification: false,
      clarificationPrompt: "",
      tasks: [
        { title: "调研候选框架", details: "调研候选框架", dependsOn: [], onDependencyFailure: "ask_user", dependencyFailurePrompt: "" },
        { title: "筛选 Top 3 框架", details: "筛选 Top 3 框架", dependsOn: [1], onDependencyFailure: "abort", dependencyFailurePrompt: "" },
        { title: "分析框架 A", details: "分析 shortlisted 框架 A", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "生成框架 A 架构图", details: "生成框架 A 架构图", dependsOn: [3], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "保存框架 A 结果", details: "保存框架 A 结果", dependsOn: [4], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "分析框架 B", details: "分析 shortlisted 框架 B", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "生成框架 B 架构图", details: "生成框架 B 架构图", dependsOn: [6], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "保存框架 B 结果", details: "保存框架 B 结果", dependsOn: [7], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "分析框架 C", details: "分析 shortlisted 框架 C", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "生成框架 C 架构图", details: "生成框架 C 架构图", dependsOn: [9], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "保存框架 C 结果", details: "保存框架 C 结果", dependsOn: [10], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
      ],
    }),
    JSON.stringify({
      summary: "I interpreted your request as 8 tasks.",
      needsClarification: false,
      clarificationPrompt: "",
      tasks: [
        { title: "调研候选框架", details: "调研候选框架", dependsOn: [], onDependencyFailure: "ask_user", dependencyFailurePrompt: "" },
        { title: "筛选两个框架", details: "筛选两个框架", dependsOn: [1], onDependencyFailure: "abort", dependencyFailurePrompt: "" },
        { title: "分析框架 A", details: "分析 shortlisted 框架 A", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "生成框架 A 架构图", details: "生成框架 A 架构图", dependsOn: [3], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "保存框架 A 结果", details: "保存框架 A 结果", dependsOn: [4], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "分析框架 B", details: "分析 shortlisted 框架 B", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "生成框架 B 架构图", details: "生成框架 B 架构图", dependsOn: [6], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "保存框架 B 结果", details: "保存框架 B 结果", dependsOn: [7], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
      ],
    }),
  ];

  const agent = new CodexMainAgent({
    codexClient: {
      startThread() {
        return {
          async run(prompt) {
            prompts.push(prompt);
            return { finalResponse: responses.shift() };
          },
        };
      },
    },
  });

  const analysis = await agent.analyzeTodo("调研两个框架，给这俩分别生成架构图并保存。");

  assert.equal(prompts.length, 2);
  assert.equal(analysis.needsClarification, false);
  assert.equal(analysis.tasks[1].title, "筛选两个框架");
});

test("CodexMainAgent retries when a Chinese direct entity count is paired with '给这俩都生成'", async () => {
  const prompts = [];
  const responses = [
    JSON.stringify({
      summary: "I interpreted your request as 11 tasks.",
      needsClarification: false,
      clarificationPrompt: "",
      tasks: [
        { title: "调研候选框架", details: "调研候选框架", dependsOn: [], onDependencyFailure: "ask_user", dependencyFailurePrompt: "" },
        { title: "筛选 Top 3 框架", details: "筛选 Top 3 框架", dependsOn: [1], onDependencyFailure: "abort", dependencyFailurePrompt: "" },
        { title: "分析框架 A", details: "分析 shortlisted 框架 A", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "生成框架 A 架构图", details: "生成框架 A 架构图", dependsOn: [3], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "保存框架 A 结果", details: "保存框架 A 结果", dependsOn: [4], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "分析框架 B", details: "分析 shortlisted 框架 B", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "生成框架 B 架构图", details: "生成框架 B 架构图", dependsOn: [6], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "保存框架 B 结果", details: "保存框架 B 结果", dependsOn: [7], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "分析框架 C", details: "分析 shortlisted 框架 C", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "生成框架 C 架构图", details: "生成框架 C 架构图", dependsOn: [9], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "保存框架 C 结果", details: "保存框架 C 结果", dependsOn: [10], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
      ],
    }),
    JSON.stringify({
      summary: "I interpreted your request as 8 tasks.",
      needsClarification: false,
      clarificationPrompt: "",
      tasks: [
        { title: "调研候选框架", details: "调研候选框架", dependsOn: [], onDependencyFailure: "ask_user", dependencyFailurePrompt: "" },
        { title: "筛选两个框架", details: "筛选两个框架", dependsOn: [1], onDependencyFailure: "abort", dependencyFailurePrompt: "" },
        { title: "分析框架 A", details: "分析 shortlisted 框架 A", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "生成框架 A 架构图", details: "生成框架 A 架构图", dependsOn: [3], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "保存框架 A 结果", details: "保存框架 A 结果", dependsOn: [4], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "分析框架 B", details: "分析 shortlisted 框架 B", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "生成框架 B 架构图", details: "生成框架 B 架构图", dependsOn: [6], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "保存框架 B 结果", details: "保存框架 B 结果", dependsOn: [7], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
      ],
    }),
  ];

  const agent = new CodexMainAgent({
    codexClient: {
      startThread() {
        return {
          async run(prompt) {
            prompts.push(prompt);
            return { finalResponse: responses.shift() };
          },
        };
      },
    },
  });

  const analysis = await agent.analyzeTodo("调研两个框架，给这俩都生成架构图并保存。");

  assert.equal(prompts.length, 2);
  assert.equal(analysis.needsClarification, false);
  assert.equal(analysis.tasks[1].title, "筛选两个框架");
});

test("CodexMainAgent retries when a direct entity count is paired with 'for the two'", async () => {
  const prompts = [];
  const responses = [
    JSON.stringify({
      summary: "I interpreted your request as 11 tasks.",
      needsClarification: false,
      clarificationPrompt: "",
      tasks: [
        { title: "Research candidate frameworks", details: "Research candidate frameworks", dependsOn: [], onDependencyFailure: "ask_user", dependencyFailurePrompt: "" },
        { title: "Shortlist Top 3 frameworks", details: "Shortlist Top 3 frameworks", dependsOn: [1], onDependencyFailure: "abort", dependencyFailurePrompt: "" },
        { title: "Analyze framework A", details: "Analyze shortlisted framework A", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate framework A diagram", details: "Generate framework A diagram", dependsOn: [3], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save framework A result", details: "Save framework A result", dependsOn: [4], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Analyze framework B", details: "Analyze shortlisted framework B", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate framework B diagram", details: "Generate framework B diagram", dependsOn: [6], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save framework B result", details: "Save framework B result", dependsOn: [7], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Analyze framework C", details: "Analyze shortlisted framework C", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate framework C diagram", details: "Generate framework C diagram", dependsOn: [9], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save framework C result", details: "Save framework C result", dependsOn: [10], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
      ],
    }),
    JSON.stringify({
      summary: "I interpreted your request as 8 tasks.",
      needsClarification: false,
      clarificationPrompt: "",
      tasks: [
        { title: "Research candidate frameworks", details: "Research candidate frameworks", dependsOn: [], onDependencyFailure: "ask_user", dependencyFailurePrompt: "" },
        { title: "Shortlist 2 frameworks", details: "Shortlist 2 frameworks", dependsOn: [1], onDependencyFailure: "abort", dependencyFailurePrompt: "" },
        { title: "Analyze framework A", details: "Analyze shortlisted framework A", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate framework A diagram", details: "Generate framework A diagram", dependsOn: [3], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save framework A result", details: "Save framework A result", dependsOn: [4], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Analyze framework B", details: "Analyze shortlisted framework B", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate framework B diagram", details: "Generate framework B diagram", dependsOn: [6], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save framework B result", details: "Save framework B result", dependsOn: [7], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
      ],
    }),
  ];

  const agent = new CodexMainAgent({
    codexClient: {
      startThread() {
        return {
          async run(prompt) {
            prompts.push(prompt);
            return { finalResponse: responses.shift() };
          },
        };
      },
    },
  });

  const analysis = await agent.analyzeTodo("Research 2 frameworks and generate a diagram for the two.");

  assert.equal(prompts.length, 2);
  assert.equal(analysis.needsClarification, false);
  assert.equal(analysis.tasks[1].title, "Shortlist 2 frameworks");
});

test("CodexMainAgent retries on mixed-language direct counts paired with 'for the two'", async () => {
  const prompts = [];
  const responses = [
    JSON.stringify({
      summary: "I interpreted your request as 11 tasks.",
      needsClarification: false,
      clarificationPrompt: "",
      tasks: [
        { title: "Research candidate frameworks", details: "Research candidate frameworks", dependsOn: [], onDependencyFailure: "ask_user", dependencyFailurePrompt: "" },
        { title: "Shortlist Top 3 frameworks", details: "Shortlist Top 3 frameworks", dependsOn: [1], onDependencyFailure: "abort", dependencyFailurePrompt: "" },
        { title: "Analyze framework A", details: "Analyze shortlisted framework A", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate framework A diagram", details: "Generate framework A diagram", dependsOn: [3], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save framework A result", details: "Save framework A result", dependsOn: [4], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Analyze framework B", details: "Analyze shortlisted framework B", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate framework B diagram", details: "Generate framework B diagram", dependsOn: [6], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save framework B result", details: "Save framework B result", dependsOn: [7], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Analyze framework C", details: "Analyze shortlisted framework C", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate framework C diagram", details: "Generate framework C diagram", dependsOn: [9], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save framework C result", details: "Save framework C result", dependsOn: [10], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
      ],
    }),
    JSON.stringify({
      summary: "I interpreted your request as 8 tasks.",
      needsClarification: false,
      clarificationPrompt: "",
      tasks: [
        { title: "Research candidate frameworks", details: "Research candidate frameworks", dependsOn: [], onDependencyFailure: "ask_user", dependencyFailurePrompt: "" },
        { title: "Shortlist 2 frameworks", details: "Shortlist 2 frameworks", dependsOn: [1], onDependencyFailure: "abort", dependencyFailurePrompt: "" },
        { title: "Analyze framework A", details: "Analyze shortlisted framework A", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate framework A diagram", details: "Generate framework A diagram", dependsOn: [3], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save framework A result", details: "Save framework A result", dependsOn: [4], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Analyze framework B", details: "Analyze shortlisted framework B", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate framework B diagram", details: "Generate framework B diagram", dependsOn: [6], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save framework B result", details: "Save framework B result", dependsOn: [7], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
      ],
    }),
  ];

  const agent = new CodexMainAgent({
    codexClient: {
      startThread() {
        return {
          async run(prompt) {
            prompts.push(prompt);
            return { finalResponse: responses.shift() };
          },
        };
      },
    },
  });

  const analysis = await agent.analyzeTodo("Research 两个 frameworks and generate a diagram for the two.");

  assert.equal(prompts.length, 2);
  assert.equal(analysis.needsClarification, false);
  assert.equal(analysis.tasks[1].title, "Shortlist 2 frameworks");
});

test("CodexMainAgent retries on mixed-language direct counts paired with Chinese pronouns", async () => {
  const prompts = [];
  const responses = [
    JSON.stringify({
      summary: "I interpreted your request as 11 tasks.",
      needsClarification: false,
      clarificationPrompt: "",
      tasks: [
        { title: "Research candidate frameworks", details: "Research candidate frameworks", dependsOn: [], onDependencyFailure: "ask_user", dependencyFailurePrompt: "" },
        { title: "Shortlist Top 3 frameworks", details: "Shortlist Top 3 frameworks", dependsOn: [1], onDependencyFailure: "abort", dependencyFailurePrompt: "" },
        { title: "Analyze framework A", details: "Analyze shortlisted framework A", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate framework A diagram", details: "Generate framework A diagram", dependsOn: [3], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save framework A result", details: "Save framework A result", dependsOn: [4], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Analyze framework B", details: "Analyze shortlisted framework B", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate framework B diagram", details: "Generate framework B diagram", dependsOn: [6], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save framework B result", details: "Save framework B result", dependsOn: [7], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Analyze framework C", details: "Analyze shortlisted framework C", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate framework C diagram", details: "Generate framework C diagram", dependsOn: [9], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save framework C result", details: "Save framework C result", dependsOn: [10], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
      ],
    }),
    JSON.stringify({
      summary: "I interpreted your request as 8 tasks.",
      needsClarification: false,
      clarificationPrompt: "",
      tasks: [
        { title: "Research candidate frameworks", details: "Research candidate frameworks", dependsOn: [], onDependencyFailure: "ask_user", dependencyFailurePrompt: "" },
        { title: "Shortlist 2 frameworks", details: "Shortlist 2 frameworks", dependsOn: [1], onDependencyFailure: "abort", dependencyFailurePrompt: "" },
        { title: "Analyze framework A", details: "Analyze shortlisted framework A", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate framework A diagram", details: "Generate framework A diagram", dependsOn: [3], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save framework A result", details: "Save framework A result", dependsOn: [4], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Analyze framework B", details: "Analyze shortlisted framework B", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate framework B diagram", details: "Generate framework B diagram", dependsOn: [6], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save framework B result", details: "Save framework B result", dependsOn: [7], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
      ],
    }),
  ];

  const agent = new CodexMainAgent({
    codexClient: {
      startThread() {
        return {
          async run(prompt) {
            prompts.push(prompt);
            return { finalResponse: responses.shift() };
          },
        };
      },
    },
  });

  const analysis = await agent.analyzeTodo("调研 two frameworks，给这两个画架构图并保存。");

  assert.equal(prompts.length, 2);
  assert.equal(analysis.needsClarification, false);
  assert.equal(analysis.tasks[1].title, "Shortlist 2 frameworks");
});

test("CodexMainAgent retries when a direct entity count is paired with 'for them both'", async () => {
  const prompts = [];
  const responses = [
    JSON.stringify({
      summary: "I interpreted your request as 11 tasks.",
      needsClarification: false,
      clarificationPrompt: "",
      tasks: [
        { title: "Research candidate frameworks", details: "Research candidate frameworks", dependsOn: [], onDependencyFailure: "ask_user", dependencyFailurePrompt: "" },
        { title: "Shortlist Top 3 frameworks", details: "Shortlist Top 3 frameworks", dependsOn: [1], onDependencyFailure: "abort", dependencyFailurePrompt: "" },
        { title: "Analyze framework A", details: "Analyze shortlisted framework A", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate framework A diagram", details: "Generate framework A diagram", dependsOn: [3], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save framework A result", details: "Save framework A result", dependsOn: [4], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Analyze framework B", details: "Analyze shortlisted framework B", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate framework B diagram", details: "Generate framework B diagram", dependsOn: [6], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save framework B result", details: "Save framework B result", dependsOn: [7], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Analyze framework C", details: "Analyze shortlisted framework C", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate framework C diagram", details: "Generate framework C diagram", dependsOn: [9], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save framework C result", details: "Save framework C result", dependsOn: [10], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
      ],
    }),
    JSON.stringify({
      summary: "I interpreted your request as 8 tasks.",
      needsClarification: false,
      clarificationPrompt: "",
      tasks: [
        { title: "Research candidate frameworks", details: "Research candidate frameworks", dependsOn: [], onDependencyFailure: "ask_user", dependencyFailurePrompt: "" },
        { title: "Shortlist 2 frameworks", details: "Shortlist 2 frameworks", dependsOn: [1], onDependencyFailure: "abort", dependencyFailurePrompt: "" },
        { title: "Analyze framework A", details: "Analyze shortlisted framework A", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate framework A diagram", details: "Generate framework A diagram", dependsOn: [3], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save framework A result", details: "Save framework A result", dependsOn: [4], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Analyze framework B", details: "Analyze shortlisted framework B", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate framework B diagram", details: "Generate framework B diagram", dependsOn: [6], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save framework B result", details: "Save framework B result", dependsOn: [7], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
      ],
    }),
  ];

  const agent = new CodexMainAgent({
    codexClient: {
      startThread() {
        return {
          async run(prompt) {
            prompts.push(prompt);
            return { finalResponse: responses.shift() };
          },
        };
      },
    },
  });

  const analysis = await agent.analyzeTodo("Research 2 frameworks and generate diagrams for them both.");

  assert.equal(prompts.length, 2);
  assert.equal(analysis.needsClarification, false);
  assert.equal(analysis.tasks[1].title, "Shortlist 2 frameworks");
});

test("CodexMainAgent retries when a direct entity count is paired with 'for both'", async () => {
  const prompts = [];
  const responses = [
    JSON.stringify({
      summary: "I interpreted your request as 11 tasks.",
      needsClarification: false,
      clarificationPrompt: "",
      tasks: [
        { title: "Research candidate frameworks", details: "Research candidate frameworks", dependsOn: [], onDependencyFailure: "ask_user", dependencyFailurePrompt: "" },
        { title: "Shortlist Top 3 frameworks", details: "Shortlist Top 3 frameworks", dependsOn: [1], onDependencyFailure: "abort", dependencyFailurePrompt: "" },
        { title: "Analyze framework A", details: "Analyze shortlisted framework A", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate framework A diagram", details: "Generate framework A diagram", dependsOn: [3], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save framework A result", details: "Save framework A result", dependsOn: [4], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Analyze framework B", details: "Analyze shortlisted framework B", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate framework B diagram", details: "Generate framework B diagram", dependsOn: [6], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save framework B result", details: "Save framework B result", dependsOn: [7], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Analyze framework C", details: "Analyze shortlisted framework C", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate framework C diagram", details: "Generate framework C diagram", dependsOn: [9], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save framework C result", details: "Save framework C result", dependsOn: [10], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
      ],
    }),
    JSON.stringify({
      summary: "I interpreted your request as 8 tasks.",
      needsClarification: false,
      clarificationPrompt: "",
      tasks: [
        { title: "Research candidate frameworks", details: "Research candidate frameworks", dependsOn: [], onDependencyFailure: "ask_user", dependencyFailurePrompt: "" },
        { title: "Shortlist 2 frameworks", details: "Shortlist 2 frameworks", dependsOn: [1], onDependencyFailure: "abort", dependencyFailurePrompt: "" },
        { title: "Analyze framework A", details: "Analyze shortlisted framework A", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate framework A diagram", details: "Generate framework A diagram", dependsOn: [3], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save framework A result", details: "Save framework A result", dependsOn: [4], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Analyze framework B", details: "Analyze shortlisted framework B", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate framework B diagram", details: "Generate framework B diagram", dependsOn: [6], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save framework B result", details: "Save framework B result", dependsOn: [7], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
      ],
    }),
  ];

  const agent = new CodexMainAgent({
    codexClient: {
      startThread() {
        return {
          async run(prompt) {
            prompts.push(prompt);
            return { finalResponse: responses.shift() };
          },
        };
      },
    },
  });

  const analysis = await agent.analyzeTodo("Research 2 frameworks and generate diagrams for both.");

  assert.equal(prompts.length, 2);
  assert.equal(analysis.needsClarification, false);
  assert.equal(analysis.tasks[1].title, "Shortlist 2 frameworks");
});

test("CodexMainAgent retries when a Chinese direct entity count is paired with '给二者都生成'", async () => {
  const prompts = [];
  const responses = [
    JSON.stringify({
      summary: "I interpreted your request as 11 tasks.",
      needsClarification: false,
      clarificationPrompt: "",
      tasks: [
        { title: "调研候选框架", details: "调研候选框架", dependsOn: [], onDependencyFailure: "ask_user", dependencyFailurePrompt: "" },
        { title: "筛选 Top 3 框架", details: "筛选 Top 3 框架", dependsOn: [1], onDependencyFailure: "abort", dependencyFailurePrompt: "" },
        { title: "分析框架 A", details: "分析 shortlisted 框架 A", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "生成框架 A 架构图", details: "生成框架 A 架构图", dependsOn: [3], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "保存框架 A 结果", details: "保存框架 A 结果", dependsOn: [4], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "分析框架 B", details: "分析 shortlisted 框架 B", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "生成框架 B 架构图", details: "生成框架 B 架构图", dependsOn: [6], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "保存框架 B 结果", details: "保存框架 B 结果", dependsOn: [7], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "分析框架 C", details: "分析 shortlisted 框架 C", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "生成框架 C 架构图", details: "生成框架 C 架构图", dependsOn: [9], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "保存框架 C 结果", details: "保存框架 C 结果", dependsOn: [10], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
      ],
    }),
    JSON.stringify({
      summary: "I interpreted your request as 8 tasks.",
      needsClarification: false,
      clarificationPrompt: "",
      tasks: [
        { title: "调研候选框架", details: "调研候选框架", dependsOn: [], onDependencyFailure: "ask_user", dependencyFailurePrompt: "" },
        { title: "筛选两个框架", details: "筛选两个框架", dependsOn: [1], onDependencyFailure: "abort", dependencyFailurePrompt: "" },
        { title: "分析框架 A", details: "分析 shortlisted 框架 A", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "生成框架 A 架构图", details: "生成框架 A 架构图", dependsOn: [3], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "保存框架 A 结果", details: "保存框架 A 结果", dependsOn: [4], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "分析框架 B", details: "分析 shortlisted 框架 B", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "生成框架 B 架构图", details: "生成框架 B 架构图", dependsOn: [6], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "保存框架 B 结果", details: "保存框架 B 结果", dependsOn: [7], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
      ],
    }),
  ];

  const agent = new CodexMainAgent({
    codexClient: {
      startThread() {
        return {
          async run(prompt) {
            prompts.push(prompt);
            return { finalResponse: responses.shift() };
          },
        };
      },
    },
  });

  const analysis = await agent.analyzeTodo("调研两个框架，给二者都生成架构图并保存。");

  assert.equal(prompts.length, 2);
  assert.equal(analysis.needsClarification, false);
  assert.equal(analysis.tasks[1].title, "筛选两个框架");
});

test("CodexMainAgent retries when a direct entity count is paired with 'for both of them'", async () => {
  const prompts = [];
  const responses = [
    JSON.stringify({
      summary: "I interpreted your request as 11 tasks.",
      needsClarification: false,
      clarificationPrompt: "",
      tasks: [
        { title: "Research candidate frameworks", details: "Research candidate frameworks", dependsOn: [], onDependencyFailure: "ask_user", dependencyFailurePrompt: "" },
        { title: "Shortlist Top 3 frameworks", details: "Shortlist Top 3 frameworks", dependsOn: [1], onDependencyFailure: "abort", dependencyFailurePrompt: "" },
        { title: "Analyze framework A", details: "Analyze shortlisted framework A", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate framework A diagram", details: "Generate framework A diagram", dependsOn: [3], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save framework A result", details: "Save framework A result", dependsOn: [4], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Analyze framework B", details: "Analyze shortlisted framework B", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate framework B diagram", details: "Generate framework B diagram", dependsOn: [6], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save framework B result", details: "Save framework B result", dependsOn: [7], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Analyze framework C", details: "Analyze shortlisted framework C", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate framework C diagram", details: "Generate framework C diagram", dependsOn: [9], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save framework C result", details: "Save framework C result", dependsOn: [10], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
      ],
    }),
    JSON.stringify({
      summary: "I interpreted your request as 8 tasks.",
      needsClarification: false,
      clarificationPrompt: "",
      tasks: [
        { title: "Research candidate frameworks", details: "Research candidate frameworks", dependsOn: [], onDependencyFailure: "ask_user", dependencyFailurePrompt: "" },
        { title: "Shortlist 2 frameworks", details: "Shortlist 2 frameworks", dependsOn: [1], onDependencyFailure: "abort", dependencyFailurePrompt: "" },
        { title: "Analyze framework A", details: "Analyze shortlisted framework A", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate framework A diagram", details: "Generate framework A diagram", dependsOn: [3], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save framework A result", details: "Save framework A result", dependsOn: [4], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Analyze framework B", details: "Analyze shortlisted framework B", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate framework B diagram", details: "Generate framework B diagram", dependsOn: [6], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save framework B result", details: "Save framework B result", dependsOn: [7], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
      ],
    }),
  ];

  const agent = new CodexMainAgent({
    codexClient: {
      startThread() {
        return {
          async run(prompt) {
            prompts.push(prompt);
            return { finalResponse: responses.shift() };
          },
        };
      },
    },
  });

  const analysis = await agent.analyzeTodo("Research 2 frameworks and generate diagrams for both of them.");

  assert.equal(prompts.length, 2);
  assert.equal(analysis.needsClarification, false);
  assert.equal(analysis.tasks[1].title, "Shortlist 2 frameworks");
});

test("CodexMainAgent retries on mixed-language direct counts paired with '给二者画图'", async () => {
  const prompts = [];
  const responses = [
    JSON.stringify({
      summary: "I interpreted your request as 11 tasks.",
      needsClarification: false,
      clarificationPrompt: "",
      tasks: [
        { title: "Research candidate frameworks", details: "Research candidate frameworks", dependsOn: [], onDependencyFailure: "ask_user", dependencyFailurePrompt: "" },
        { title: "Shortlist Top 3 frameworks", details: "Shortlist Top 3 frameworks", dependsOn: [1], onDependencyFailure: "abort", dependencyFailurePrompt: "" },
        { title: "Analyze framework A", details: "Analyze shortlisted framework A", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate framework A diagram", details: "Generate framework A diagram", dependsOn: [3], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save framework A result", details: "Save framework A result", dependsOn: [4], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Analyze framework B", details: "Analyze shortlisted framework B", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate framework B diagram", details: "Generate framework B diagram", dependsOn: [6], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save framework B result", details: "Save framework B result", dependsOn: [7], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Analyze framework C", details: "Analyze shortlisted framework C", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate framework C diagram", details: "Generate framework C diagram", dependsOn: [9], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save framework C result", details: "Save framework C result", dependsOn: [10], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
      ],
    }),
    JSON.stringify({
      summary: "I interpreted your request as 8 tasks.",
      needsClarification: false,
      clarificationPrompt: "",
      tasks: [
        { title: "Research candidate frameworks", details: "Research candidate frameworks", dependsOn: [], onDependencyFailure: "ask_user", dependencyFailurePrompt: "" },
        { title: "Shortlist 2 frameworks", details: "Shortlist 2 frameworks", dependsOn: [1], onDependencyFailure: "abort", dependencyFailurePrompt: "" },
        { title: "Analyze framework A", details: "Analyze shortlisted framework A", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate framework A diagram", details: "Generate framework A diagram", dependsOn: [3], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save framework A result", details: "Save framework A result", dependsOn: [4], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Analyze framework B", details: "Analyze shortlisted framework B", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate framework B diagram", details: "Generate framework B diagram", dependsOn: [6], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save framework B result", details: "Save framework B result", dependsOn: [7], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
      ],
    }),
  ];

  const agent = new CodexMainAgent({
    codexClient: {
      startThread() {
        return {
          async run(prompt) {
            prompts.push(prompt);
            return { finalResponse: responses.shift() };
          },
        };
      },
    },
  });

  const analysis = await agent.analyzeTodo("调研 two frameworks，给二者画架构图并保存。");

  assert.equal(prompts.length, 2);
  assert.equal(analysis.needsClarification, false);
  assert.equal(analysis.tasks[1].title, "Shortlist 2 frameworks");
});

test("CodexMainAgent retries on mixed-language direct counts paired with '给那俩都画图'", async () => {
  const prompts = [];
  const responses = [
    JSON.stringify({
      summary: "I interpreted your request as 11 tasks.",
      needsClarification: false,
      clarificationPrompt: "",
      tasks: [
        { title: "Research candidate frameworks", details: "Research candidate frameworks", dependsOn: [], onDependencyFailure: "ask_user", dependencyFailurePrompt: "" },
        { title: "Shortlist 3 frameworks", details: "Shortlist 3 frameworks", dependsOn: [1], onDependencyFailure: "abort", dependencyFailurePrompt: "" },
        { title: "Analyze framework A", details: "Analyze shortlisted framework A", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate framework A diagram", details: "Generate framework A diagram", dependsOn: [3], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save framework A result", details: "Save framework A result", dependsOn: [4], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Analyze framework B", details: "Analyze shortlisted framework B", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate framework B diagram", details: "Generate framework B diagram", dependsOn: [6], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save framework B result", details: "Save framework B result", dependsOn: [7], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Analyze framework C", details: "Analyze shortlisted framework C", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate framework C diagram", details: "Generate framework C diagram", dependsOn: [9], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save framework C result", details: "Save framework C result", dependsOn: [10], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
      ],
    }),
    JSON.stringify({
      summary: "I interpreted your request as 8 tasks.",
      needsClarification: false,
      clarificationPrompt: "",
      tasks: [
        { title: "Research candidate frameworks", details: "Research candidate frameworks", dependsOn: [], onDependencyFailure: "ask_user", dependencyFailurePrompt: "" },
        { title: "Shortlist 2 frameworks", details: "Shortlist 2 frameworks", dependsOn: [1], onDependencyFailure: "abort", dependencyFailurePrompt: "" },
        { title: "Analyze framework A", details: "Analyze shortlisted framework A", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate framework A diagram", details: "Generate framework A diagram", dependsOn: [3], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save framework A result", details: "Save framework A result", dependsOn: [4], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Analyze framework B", details: "Analyze shortlisted framework B", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate framework B diagram", details: "Generate framework B diagram", dependsOn: [6], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save framework B result", details: "Save framework B result", dependsOn: [7], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
      ],
    }),
  ];

  const agent = new CodexMainAgent({
    codexClient: {
      startThread() {
        return {
          async run(prompt) {
            prompts.push(prompt);
            return { finalResponse: responses.shift() };
          },
        };
      },
    },
  });

  const analysis = await agent.analyzeTodo("调研 two frameworks，给那俩都画架构图并保存。");

  assert.equal(prompts.length, 2);
  assert.equal(analysis.needsClarification, false);
  assert.equal(analysis.tasks[1].title, "Shortlist 2 frameworks");
});

test("CodexMainAgent retries on mixed-language direct counts paired with '给那两个画图'", async () => {
  const prompts = [];
  const responses = [
    JSON.stringify({
      summary: "I interpreted your request as 11 tasks.",
      needsClarification: false,
      clarificationPrompt: "",
      tasks: [
        { title: "Research candidate frameworks", details: "Research candidate frameworks", dependsOn: [], onDependencyFailure: "ask_user", dependencyFailurePrompt: "" },
        { title: "Shortlist 3 frameworks", details: "Shortlist 3 frameworks", dependsOn: [1], onDependencyFailure: "abort", dependencyFailurePrompt: "" },
        { title: "Analyze framework A", details: "Analyze shortlisted framework A", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate framework A diagram", details: "Generate framework A diagram", dependsOn: [3], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save framework A result", details: "Save framework A result", dependsOn: [4], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Analyze framework B", details: "Analyze shortlisted framework B", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate framework B diagram", details: "Generate framework B diagram", dependsOn: [6], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save framework B result", details: "Save framework B result", dependsOn: [7], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Analyze framework C", details: "Analyze shortlisted framework C", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate framework C diagram", details: "Generate framework C diagram", dependsOn: [9], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save framework C result", details: "Save framework C result", dependsOn: [10], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
      ],
    }),
    JSON.stringify({
      summary: "I interpreted your request as 8 tasks.",
      needsClarification: false,
      clarificationPrompt: "",
      tasks: [
        { title: "Research candidate frameworks", details: "Research candidate frameworks", dependsOn: [], onDependencyFailure: "ask_user", dependencyFailurePrompt: "" },
        { title: "Shortlist 2 frameworks", details: "Shortlist 2 frameworks", dependsOn: [1], onDependencyFailure: "abort", dependencyFailurePrompt: "" },
        { title: "Analyze framework A", details: "Analyze shortlisted framework A", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate framework A diagram", details: "Generate framework A diagram", dependsOn: [3], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save framework A result", details: "Save framework A result", dependsOn: [4], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Analyze framework B", details: "Analyze shortlisted framework B", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate framework B diagram", details: "Generate framework B diagram", dependsOn: [6], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save framework B result", details: "Save framework B result", dependsOn: [7], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
      ],
    }),
  ];

  const agent = new CodexMainAgent({
    codexClient: {
      startThread() {
        return {
          async run(prompt) {
            prompts.push(prompt);
            return { finalResponse: responses.shift() };
          },
        };
      },
    },
  });

  const analysis = await agent.analyzeTodo("调研 two frameworks，给那两个画架构图并保存。");

  assert.equal(prompts.length, 2);
  assert.equal(analysis.needsClarification, false);
  assert.equal(analysis.tasks[1].title, "Shortlist 2 frameworks");
});

test("CodexMainAgent retries on mixed-language direct counts paired with '给它们两个画图'", async () => {
  const prompts = [];
  const responses = [
    JSON.stringify({
      summary: "I interpreted your request as 11 tasks.",
      needsClarification: false,
      clarificationPrompt: "",
      tasks: [
        { title: "Research candidate frameworks", details: "Research candidate frameworks", dependsOn: [], onDependencyFailure: "ask_user", dependencyFailurePrompt: "" },
        { title: "Shortlist 3 frameworks", details: "Shortlist 3 frameworks", dependsOn: [1], onDependencyFailure: "abort", dependencyFailurePrompt: "" },
        { title: "Analyze framework A", details: "Analyze shortlisted framework A", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate framework A diagram", details: "Generate framework A diagram", dependsOn: [3], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save framework A result", details: "Save framework A result", dependsOn: [4], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Analyze framework B", details: "Analyze shortlisted framework B", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate framework B diagram", details: "Generate framework B diagram", dependsOn: [6], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save framework B result", details: "Save framework B result", dependsOn: [7], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Analyze framework C", details: "Analyze shortlisted framework C", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate framework C diagram", details: "Generate framework C diagram", dependsOn: [9], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save framework C result", details: "Save framework C result", dependsOn: [10], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
      ],
    }),
    JSON.stringify({
      summary: "I interpreted your request as 8 tasks.",
      needsClarification: false,
      clarificationPrompt: "",
      tasks: [
        { title: "Research candidate frameworks", details: "Research candidate frameworks", dependsOn: [], onDependencyFailure: "ask_user", dependencyFailurePrompt: "" },
        { title: "Shortlist 2 frameworks", details: "Shortlist 2 frameworks", dependsOn: [1], onDependencyFailure: "abort", dependencyFailurePrompt: "" },
        { title: "Analyze framework A", details: "Analyze shortlisted framework A", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate framework A diagram", details: "Generate framework A diagram", dependsOn: [3], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save framework A result", details: "Save framework A result", dependsOn: [4], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Analyze framework B", details: "Analyze shortlisted framework B", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate framework B diagram", details: "Generate framework B diagram", dependsOn: [6], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save framework B result", details: "Save framework B result", dependsOn: [7], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
      ],
    }),
  ];

  const agent = new CodexMainAgent({
    codexClient: {
      startThread() {
        return {
          async run(prompt) {
            prompts.push(prompt);
            return { finalResponse: responses.shift() };
          },
        };
      },
    },
  });

  const analysis = await agent.analyzeTodo("调研 two frameworks，给它们两个画架构图并保存。");

  assert.equal(prompts.length, 2);
  assert.equal(analysis.needsClarification, false);
  assert.equal(analysis.tasks[1].title, "Shortlist 2 frameworks");
});

test("CodexMainAgent retries on mixed-language direct counts paired with '给它们分别画图'", async () => {
  const prompts = [];
  const responses = [
    JSON.stringify({
      summary: "I interpreted your request as 11 tasks.",
      needsClarification: false,
      clarificationPrompt: "",
      tasks: [
        { title: "Research candidate frameworks", details: "Research candidate frameworks", dependsOn: [], onDependencyFailure: "ask_user", dependencyFailurePrompt: "" },
        { title: "Shortlist 3 frameworks", details: "Shortlist 3 frameworks", dependsOn: [1], onDependencyFailure: "abort", dependencyFailurePrompt: "" },
        { title: "Analyze framework A", details: "Analyze shortlisted framework A", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate framework A diagram", details: "Generate framework A diagram", dependsOn: [3], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save framework A result", details: "Save framework A result", dependsOn: [4], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Analyze framework B", details: "Analyze shortlisted framework B", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate framework B diagram", details: "Generate framework B diagram", dependsOn: [6], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save framework B result", details: "Save framework B result", dependsOn: [7], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Analyze framework C", details: "Analyze shortlisted framework C", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate framework C diagram", details: "Generate framework C diagram", dependsOn: [9], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save framework C result", details: "Save framework C result", dependsOn: [10], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
      ],
    }),
    JSON.stringify({
      summary: "I interpreted your request as 8 tasks.",
      needsClarification: false,
      clarificationPrompt: "",
      tasks: [
        { title: "Research candidate frameworks", details: "Research candidate frameworks", dependsOn: [], onDependencyFailure: "ask_user", dependencyFailurePrompt: "" },
        { title: "Shortlist 2 frameworks", details: "Shortlist 2 frameworks", dependsOn: [1], onDependencyFailure: "abort", dependencyFailurePrompt: "" },
        { title: "Analyze framework A", details: "Analyze shortlisted framework A", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate framework A diagram", details: "Generate framework A diagram", dependsOn: [3], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save framework A result", details: "Save framework A result", dependsOn: [4], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Analyze framework B", details: "Analyze shortlisted framework B", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate framework B diagram", details: "Generate framework B diagram", dependsOn: [6], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save framework B result", details: "Save framework B result", dependsOn: [7], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
      ],
    }),
  ];

  const agent = new CodexMainAgent({
    codexClient: {
      startThread() {
        return {
          async run(prompt) {
            prompts.push(prompt);
            return { finalResponse: responses.shift() };
          },
        };
      },
    },
  });

  const analysis = await agent.analyzeTodo("调研 two frameworks，给它们分别画架构图并保存。");

  assert.equal(prompts.length, 2);
  assert.equal(analysis.needsClarification, false);
  assert.equal(analysis.tasks[1].title, "Shortlist 2 frameworks");
});

test("CodexMainAgent retries on mixed-language direct counts paired with '分别处理它们'", async () => {
  const prompts = [];
  const responses = [
    JSON.stringify({
      summary: "I interpreted your request as 11 tasks.",
      needsClarification: false,
      clarificationPrompt: "",
      tasks: [
        { title: "Research candidate frameworks", details: "Research candidate frameworks", dependsOn: [], onDependencyFailure: "ask_user", dependencyFailurePrompt: "" },
        { title: "Shortlist 3 frameworks", details: "Shortlist 3 frameworks", dependsOn: [1], onDependencyFailure: "abort", dependencyFailurePrompt: "" },
        { title: "Analyze framework A", details: "Analyze shortlisted framework A", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate framework A diagram", details: "Generate framework A diagram", dependsOn: [3], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save framework A result", details: "Save framework A result", dependsOn: [4], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Analyze framework B", details: "Analyze shortlisted framework B", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate framework B diagram", details: "Generate framework B diagram", dependsOn: [6], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save framework B result", details: "Save framework B result", dependsOn: [7], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Analyze framework C", details: "Analyze shortlisted framework C", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate framework C diagram", details: "Generate framework C diagram", dependsOn: [9], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save framework C result", details: "Save framework C result", dependsOn: [10], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
      ],
    }),
    JSON.stringify({
      summary: "I interpreted your request as 8 tasks.",
      needsClarification: false,
      clarificationPrompt: "",
      tasks: [
        { title: "Research candidate frameworks", details: "Research candidate frameworks", dependsOn: [], onDependencyFailure: "ask_user", dependencyFailurePrompt: "" },
        { title: "Shortlist 2 frameworks", details: "Shortlist 2 frameworks", dependsOn: [1], onDependencyFailure: "abort", dependencyFailurePrompt: "" },
        { title: "Analyze framework A", details: "Analyze shortlisted framework A", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate framework A diagram", details: "Generate framework A diagram", dependsOn: [3], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save framework A result", details: "Save framework A result", dependsOn: [4], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Analyze framework B", details: "Analyze shortlisted framework B", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate framework B diagram", details: "Generate framework B diagram", dependsOn: [6], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save framework B result", details: "Save framework B result", dependsOn: [7], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
      ],
    }),
  ];

  const agent = new CodexMainAgent({
    codexClient: {
      startThread() {
        return {
          async run(prompt) {
            prompts.push(prompt);
            return { finalResponse: responses.shift() };
          },
        };
      },
    },
  });

  const analysis = await agent.analyzeTodo("调研 two frameworks，分别处理它们并保存架构图。");

  assert.equal(prompts.length, 2);
  assert.equal(analysis.needsClarification, false);
  assert.equal(analysis.tasks[1].title, "Shortlist 2 frameworks");
});

test("CodexMainAgent retries when a direct entity count is paired with 'each of them'", async () => {
  const prompts = [];
  const responses = [
    JSON.stringify({
      summary: "I interpreted your request as 11 tasks.",
      needsClarification: false,
      clarificationPrompt: "",
      tasks: [
        { title: "Research candidate frameworks", details: "Research candidate frameworks", dependsOn: [], onDependencyFailure: "ask_user", dependencyFailurePrompt: "" },
        { title: "Shortlist 3 frameworks", details: "Shortlist 3 frameworks", dependsOn: [1], onDependencyFailure: "abort", dependencyFailurePrompt: "" },
        { title: "Analyze framework A", details: "Analyze shortlisted framework A", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate framework A diagram", details: "Generate framework A diagram", dependsOn: [3], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save framework A result", details: "Save framework A result", dependsOn: [4], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Analyze framework B", details: "Analyze shortlisted framework B", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate framework B diagram", details: "Generate framework B diagram", dependsOn: [6], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save framework B result", details: "Save framework B result", dependsOn: [7], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Analyze framework C", details: "Analyze shortlisted framework C", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate framework C diagram", details: "Generate framework C diagram", dependsOn: [9], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save framework C result", details: "Save framework C result", dependsOn: [10], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
      ],
    }),
    JSON.stringify({
      summary: "I interpreted your request as 8 tasks.",
      needsClarification: false,
      clarificationPrompt: "",
      tasks: [
        { title: "Research candidate frameworks", details: "Research candidate frameworks", dependsOn: [], onDependencyFailure: "ask_user", dependencyFailurePrompt: "" },
        { title: "Shortlist 2 frameworks", details: "Shortlist 2 frameworks", dependsOn: [1], onDependencyFailure: "abort", dependencyFailurePrompt: "" },
        { title: "Analyze framework A", details: "Analyze shortlisted framework A", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate framework A diagram", details: "Generate framework A diagram", dependsOn: [3], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save framework A result", details: "Save framework A result", dependsOn: [4], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Analyze framework B", details: "Analyze shortlisted framework B", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate framework B diagram", details: "Generate framework B diagram", dependsOn: [6], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save framework B result", details: "Save framework B result", dependsOn: [7], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
      ],
    }),
  ];

  const agent = new CodexMainAgent({
    codexClient: {
      startThread() {
        return {
          async run(prompt) {
            prompts.push(prompt);
            return { finalResponse: responses.shift() };
          },
        };
      },
    },
  });

  const analysis = await agent.analyzeTodo("Research 2 frameworks and generate a diagram for each of them.");

  assert.equal(prompts.length, 2);
  assert.equal(analysis.needsClarification, false);
  assert.equal(analysis.tasks[1].title, "Shortlist 2 frameworks");
});

test("CodexMainAgent retries when a direct entity count is paired with 'the two of them'", async () => {
  const prompts = [];
  const responses = [
    JSON.stringify({
      summary: "I interpreted your request as 11 tasks.",
      needsClarification: false,
      clarificationPrompt: "",
      tasks: [
        { title: "Research candidate frameworks", details: "Research candidate frameworks", dependsOn: [], onDependencyFailure: "ask_user", dependencyFailurePrompt: "" },
        { title: "Shortlist 3 frameworks", details: "Shortlist 3 frameworks", dependsOn: [1], onDependencyFailure: "abort", dependencyFailurePrompt: "" },
        { title: "Analyze framework A", details: "Analyze shortlisted framework A", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate framework A diagram", details: "Generate framework A diagram", dependsOn: [3], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save framework A result", details: "Save framework A result", dependsOn: [4], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Analyze framework B", details: "Analyze shortlisted framework B", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate framework B diagram", details: "Generate framework B diagram", dependsOn: [6], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save framework B result", details: "Save framework B result", dependsOn: [7], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Analyze framework C", details: "Analyze shortlisted framework C", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate framework C diagram", details: "Generate framework C diagram", dependsOn: [9], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save framework C result", details: "Save framework C result", dependsOn: [10], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
      ],
    }),
    JSON.stringify({
      summary: "I interpreted your request as 8 tasks.",
      needsClarification: false,
      clarificationPrompt: "",
      tasks: [
        { title: "Research candidate frameworks", details: "Research candidate frameworks", dependsOn: [], onDependencyFailure: "ask_user", dependencyFailurePrompt: "" },
        { title: "Shortlist 2 frameworks", details: "Shortlist 2 frameworks", dependsOn: [1], onDependencyFailure: "abort", dependencyFailurePrompt: "" },
        { title: "Analyze framework A", details: "Analyze shortlisted framework A", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate framework A diagram", details: "Generate framework A diagram", dependsOn: [3], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save framework A result", details: "Save framework A result", dependsOn: [4], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Analyze framework B", details: "Analyze shortlisted framework B", dependsOn: [2], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Generate framework B diagram", details: "Generate framework B diagram", dependsOn: [6], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
        { title: "Save framework B result", details: "Save framework B result", dependsOn: [7], onDependencyFailure: "skip", dependencyFailurePrompt: "" },
      ],
    }),
  ];

  const agent = new CodexMainAgent({
    codexClient: {
      startThread() {
        return {
          async run(prompt) {
            prompts.push(prompt);
            return { finalResponse: responses.shift() };
          },
        };
      },
    },
  });

  const analysis = await agent.analyzeTodo("Research 2 frameworks and generate diagrams for the two of them.");

  assert.equal(prompts.length, 2);
  assert.equal(analysis.needsClarification, false);
  assert.equal(analysis.tasks[1].title, "Shortlist 2 frameworks");
});

test("CodexMainAgent reuses the same Codex thread across clarification turns", async () => {
  let threadCount = 0;
  const prompts = [];
  const agent = new CodexMainAgent({
    codexClient: {
      startThread() {
        threadCount += 1;
        return {
          async run(prompt) {
            prompts.push(prompt);
            return {
              finalResponse: JSON.stringify({
                summary: "ok",
                needsClarification: false,
                clarificationPrompt: "",
                tasks: [
                  {
                    title: "Task",
                    details: "Task",
                    dependsOn: [],
                    onDependencyFailure: "ask_user",
                    dependencyFailurePrompt: "",
                  },
                ],
              }),
            };
          },
        };
      },
    },
  });

  await agent.analyzeTodo("first input");
  await agent.analyzeTodo("second input");

  assert.equal(threadCount, 1);
  assert.equal(prompts.length, 2);
  assert.match(prompts[0], /first input/);
  assert.match(prompts[1], /second input/);
});

test("CodexMainAgent shutdown aborts the in-flight turn", async () => {
  let abortSeen = false;
  const agent = new CodexMainAgent({
    codexClient: {
      startThread() {
        return {
          async run(_prompt, turnOptions) {
            await new Promise((resolve, reject) => {
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

  const pending = agent.analyzeTodo("long running input");
  agent.shutdown();

  await assert.rejects(pending, /Execution interrupted/);
  assert.equal(abortSeen, true);
});

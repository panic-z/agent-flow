import test from "node:test";
import assert from "node:assert/strict";

import { CodexMainAgent } from "../src/agents/codex-main-agent.js";

test("CodexMainAgent returns structured task analysis from the Codex SDK", async () => {
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
                summary: "I interpreted your request as 2 tasks.",
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
                    title: "画出他们的架构图并保存在本地",
                    details: "画出他们的架构图并保存在本地",
                    dependsOn: [1],
                    onDependencyFailure: "abort",
                    dependencyFailurePrompt: "This diagram requires the research output first, so abort if task 1 fails.",
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

  assert.equal(analysis.tasks.length, 2);
  assert.equal(analysis.tasks[0].id, 1);
  assert.equal(analysis.tasks[1].id, 2);
  assert.deepEqual(analysis.tasks[0].dependsOn, []);
  assert.deepEqual(analysis.tasks[1].dependsOn, [1]);
  assert.equal(analysis.tasks[0].onDependencyFailure, "ask_user");
  assert.equal(analysis.tasks[1].onDependencyFailure, "abort");
  assert.match(analysis.tasks[1].dependencyFailurePrompt, /requires the research output/);
  assert.equal(seen[0].options.skipGitRepoCheck, true);
  assert.ok(seen[1].turnOptions.outputSchema);
  assert.match(seen[1].prompt, /You are the main agent/);
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

import test from "node:test";
import assert from "node:assert/strict";

import { parseTodoText } from "../src/lib/todo-intake.js";

test("parseTodoText splits semicolons and newlines into normalized tasks", () => {
  const tasks = parseTodoText("buy milk; draft weekly update\n clean tmp files ");

  assert.deepEqual(
    tasks.map((task) => ({
      id: task.id,
      title: task.title,
      details: task.details,
      status: task.status,
    })),
    [
      { id: 1, title: "Buy milk", details: "buy milk", status: "pending" },
      { id: 2, title: "Draft weekly update", details: "draft weekly update", status: "pending" },
      { id: 3, title: "Clean tmp files", details: "clean tmp files", status: "pending" },
    ],
  );
});

test("parseTodoText splits numbered lists into separate tasks", () => {
  const tasks = parseTodoText("1. 全网搜集热门的harness框架 2. 画出他们的架构图并保存在本地");

  assert.deepEqual(
    tasks.map((task) => ({
      id: task.id,
      title: task.title,
      details: task.details,
      status: task.status,
    })),
    [
      {
        id: 1,
        title: "全网搜集热门的harness框架",
        details: "全网搜集热门的harness框架",
        status: "pending",
      },
      {
        id: 2,
        title: "画出他们的架构图并保存在本地",
        details: "画出他们的架构图并保存在本地",
        status: "pending",
      },
    ],
  );
});

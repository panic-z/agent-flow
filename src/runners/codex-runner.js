import fs from "node:fs/promises";
import path from "node:path";

import { Codex } from "@openai/codex-sdk";

const RESULT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    status: {
      type: "string",
      enum: ["success", "failed"],
    },
    summary: {
      type: "string",
    },
    artifacts: {
      type: "array",
      items: {
        type: "string",
      },
    },
  },
  required: ["status", "summary", "artifacts"],
};

export class CodexRunner {
  constructor({
    codexClient,
    cwd = process.cwd(),
    timeoutMs = 60_000,
    model = "gpt-5.4",
  } = {}) {
    this.cwd = cwd;
    this.timeoutMs = timeoutMs;
    this.model = model;
    this.codexClient = codexClient ?? new Codex();
    this.shutdownController = new AbortController();
  }

  async runTask(task, context = { completedTasks: [] }) {
    const executionPlan = await resolveTaskExecutionPlan({
      cwd: this.cwd,
      baseTimeoutMs: this.timeoutMs,
      task,
    });
    const log = typeof context.onLog === "function" ? context.onLog : () => {};
    const prompt = buildCodexPrompt(task, executionPlan, context);
    const signal = anySignal([AbortSignal.timeout(executionPlan.timeoutMs), this.shutdownController.signal]);
    log(buildExecutionDiagnostics(executionPlan));
    const thread = this.codexClient.startThread({
      model: this.model,
      approvalPolicy: "never",
      sandboxMode: "danger-full-access",
      workingDirectory: this.cwd,
      skipGitRepoCheck: true,
      webSearchEnabled: executionPlan.hints.requiresResearch,
      networkAccessEnabled: executionPlan.hints.requiresResearch,
    });

    try {
      const turn = await thread.run(prompt, {
        outputSchema: RESULT_SCHEMA,
        signal,
      });

      return extractAgentResult(turn.finalResponse, turn.finalResponse);
    } catch (error) {
      if (this.shutdownController.signal.aborted) {
        throw new Error("Execution interrupted.");
      }
      if (error?.name === "AbortError") {
        log(`Child agent timed out after ${executionPlan.timeoutMs}ms. Check ${executionPlan.relativeArtifactDir} for any partial outputs.`);
        return {
          status: "failed",
          summary: `Task timed out after ${executionPlan.timeoutMs}ms.`,
          artifacts: [],
          rawOutput: "",
        };
      }

      return {
        status: "failed",
        summary: error instanceof Error ? error.message : String(error),
        artifacts: [],
        rawOutput: "",
      };
    }
  }

  shutdown() {
    if (!this.shutdownController.signal.aborted) {
      this.shutdownController.abort();
    }
  }
}

function buildExecutionDiagnostics(executionPlan) {
  return [
    `Timeout budget: ${executionPlan.timeoutMs}ms.`,
    `Web search: ${executionPlan.hints.requiresResearch ? "enabled" : "disabled"}.`,
    `Artifact directory: ${executionPlan.relativeArtifactDir}.`,
  ].join(" ");
}

function anySignal(signals) {
  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any(signals);
  }

  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      break;
    }
    signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
  }
  return controller.signal;
}

export function extractAgentResult(output, rawOutput = output) {
  let parsed;
  try {
    parsed = JSON.parse(output);
  } catch {
    throw new Error("No valid JSON result found in agent output.");
  }

  if (!parsed || typeof parsed !== "object" || !parsed.status || !parsed.summary) {
    throw new Error("No valid JSON result found in agent output.");
  }

  return {
    status: parsed.status === "success" ? "success" : "failed",
    summary: String(parsed.summary),
    artifacts: Array.isArray(parsed.artifacts) ? parsed.artifacts : [],
    rawOutput,
  };
}

export function inferExecutionHints(task) {
  const text = `${task.title} ${task.details}`.toLowerCase();
  return {
    requiresResearch: /(搜集|research|search|全网|调研|查找|find)/i.test(text),
    requiresLocalArtifacts: /(保存|save|file|图|diagram|架构图|png|svg|md|mermaid)/i.test(text),
  };
}

export async function resolveTaskExecutionPlan({ cwd, baseTimeoutMs, task }) {
  const hints = inferExecutionHints(task);
  const timeoutMultiplier = hints.requiresResearch && hints.requiresLocalArtifacts
    ? 4
    : hints.requiresResearch || hints.requiresLocalArtifacts
      ? 2
      : 1;
  const artifactDir = path.join(cwd, "outputs", `task-${task.id}`);

  await fs.mkdir(artifactDir, { recursive: true });

  return {
    hints,
    timeoutMs: baseTimeoutMs * timeoutMultiplier,
    artifactDir,
    relativeArtifactDir: path.relative(cwd, artifactDir) || ".",
  };
}

function buildCodexPrompt(task, executionPlan, context) {
  const hints = executionPlan.hints;
  return [
    "You are a child agent in a multi-agent orchestrator demo.",
    "Handle exactly one task. Do not ask follow-up questions.",
    "Return strict JSON only, matching the provided schema.",
    "Task title:",
    task.title,
    "Task details:",
    task.details,
    formatPreviousResults(context.completedTasks ?? []),
    hints.requiresResearch
      ? "Use web search when you need current or external information."
      : "Do not do unnecessary external research.",
    hints.requiresLocalArtifacts
      ? [
          `If you create local files, save them under ${executionPlan.relativeArtifactDir}.`,
          "List relative file paths in artifacts.",
          "For architecture diagrams, prefer Mermaid in a .md or .mmd file unless another format is explicitly requested.",
        ].join("\n")
      : "Return an empty artifacts array unless you actually create local files.",
  ].join("\n");
}

function formatPreviousResults(completedTasks) {
  if (completedTasks.length === 0) {
    return "Previous completed task results:\n(none)";
  }

  return [
    "Previous completed task results:",
    ...completedTasks.map((task) => [
      `#${task.id} ${task.title}`,
      `status: ${task.status}`,
      `summary: ${task.resultSummary || "(none)"}`,
      `artifacts: ${task.artifacts?.length ? task.artifacts.join(", ") : "(none)"}`,
    ].join("\n")),
  ].join("\n");
}

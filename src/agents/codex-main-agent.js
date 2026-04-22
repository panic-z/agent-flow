import { Codex } from "@openai/codex-sdk";

const ANALYSIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: {
      type: "string",
    },
    needsClarification: {
      type: "boolean",
    },
    clarificationPrompt: {
      type: "string",
    },
    tasks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          details: { type: "string" },
          dependsOn: {
            type: "array",
            items: {
              type: "integer",
              minimum: 1,
            },
          },
          onDependencyFailure: {
            type: "string",
            enum: ["ask_user", "skip", "abort"],
          },
          dependencyFailurePrompt: {
            type: "string",
          },
        },
        required: ["title", "details", "dependsOn", "onDependencyFailure", "dependencyFailurePrompt"],
      },
    },
  },
  required: ["summary", "needsClarification", "clarificationPrompt", "tasks"],
};

export class CodexMainAgent {
  constructor({
    codexClient,
    cwd = process.cwd(),
    model = "gpt-5.4",
    timeoutMs = 60_000,
  } = {}) {
    this.cwd = cwd;
    this.model = model;
    this.timeoutMs = timeoutMs;
    this.codexClient = codexClient ?? new Codex();
    this.thread = null;
    this.shutdownController = new AbortController();
  }

  async analyzeTodo(input) {
    const signal = anySignal([AbortSignal.timeout(this.timeoutMs), this.shutdownController.signal]);
    const thread = this.getThread();

    try {
      const turn = await thread.run(buildAnalysisPrompt(input), {
        outputSchema: ANALYSIS_SCHEMA,
        signal,
      });

      return normalizeAnalysis(turn.finalResponse);
    } catch (error) {
      if (this.shutdownController.signal.aborted) {
        throw new Error("Execution interrupted.");
      }
      return fallbackClarification();
    }
  }

  getThread() {
    if (!this.thread) {
      this.thread = this.codexClient.startThread({
        model: this.model,
        approvalPolicy: "never",
        sandboxMode: "danger-full-access",
        workingDirectory: this.cwd,
        skipGitRepoCheck: true,
      });
    }

    return this.thread;
  }

  shutdown() {
    if (!this.shutdownController.signal.aborted) {
      this.shutdownController.abort();
    }
  }
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

function buildAnalysisPrompt(input) {
  return [
    "You are the main agent in a multi-agent orchestrator demo.",
    "Analyze the user's todo list and return strict JSON only.",
    "If the input is ambiguous, set needsClarification to true and explain what should be clarified.",
    "If the input is clear, split it into an ordered list of executable tasks.",
    "For each task, include dependsOn as an array of earlier task ids that must succeed before this task should run.",
    "Use an empty array when a task can run independently.",
    "For each task, include onDependencyFailure with one of: ask_user, skip, abort.",
    "Use ask_user when human input is needed, skip when the dependent task should be dropped automatically, and abort when the run should stop.",
    "Include dependencyFailurePrompt as a short user-facing explanation for what should happen if dependencies fail.",
    "Never leave tasks empty unless clarification is required.",
    "User input:",
    input,
  ].join("\n");
}

function normalizeAnalysis(output) {
  let parsed;
  try {
    parsed = JSON.parse(output);
  } catch {
    return fallbackClarification();
  }

  const tasks = Array.isArray(parsed.tasks)
    ? parsed.tasks
        .filter((task) => task && task.title && task.details)
        .map((task, index) => ({
          id: index + 1,
          title: task.title.trim(),
          details: task.details.trim(),
          dependsOn: normalizeDependsOn(task.dependsOn, index + 1),
          onDependencyFailure: normalizeDependencyPolicy(task.onDependencyFailure),
          dependencyFailurePrompt:
            typeof task.dependencyFailurePrompt === "string" ? task.dependencyFailurePrompt.trim() : "",
          status: "pending",
          resultSummary: "",
          rawOutput: "",
        }))
    : [];

  return {
    summary: typeof parsed.summary === "string" ? parsed.summary : `I interpreted your request as ${tasks.length} task${tasks.length === 1 ? "" : "s"}.`,
    needsClarification: Boolean(parsed.needsClarification),
    clarificationPrompt: typeof parsed.clarificationPrompt === "string" ? parsed.clarificationPrompt : "",
    tasks,
  };
}

function normalizeDependsOn(dependsOn, taskId) {
  if (!Array.isArray(dependsOn)) {
    return [];
  }

  return dependsOn
    .filter((dependencyId) => Number.isInteger(dependencyId) && dependencyId > 0 && dependencyId < taskId)
    .sort((left, right) => left - right);
}

function normalizeDependencyPolicy(policy) {
  return policy === "skip" || policy === "abort" ? policy : "ask_user";
}

function fallbackClarification() {
  return {
    summary: "I need clarification before I can build a reliable execution plan.",
    needsClarification: true,
    clarificationPrompt: "I could not confidently determine the task breakdown. Please rewrite the todo list with clearer task boundaries.",
    tasks: [],
  };
}

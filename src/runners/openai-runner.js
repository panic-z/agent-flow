import fs from "node:fs/promises";
import path from "node:path";

import OpenAI from "openai";

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
    file_writes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          path: {
            type: "string",
          },
          content: {
            type: "string",
          },
        },
        required: ["path", "content"],
      },
    },
  },
  required: ["status", "summary", "artifacts", "file_writes"],
};

export class OpenAIRunner {
  constructor({
    client,
    apiKey = process.env.OPENAI_API_KEY,
    cwd = process.cwd(),
    model = "gpt-5.2",
    timeoutMs = 60_000,
  } = {}) {
    this.client = client ?? new OpenAI({ apiKey });
    this.cwd = cwd;
    this.model = model;
    this.timeoutMs = timeoutMs;
  }

  async runTask(task, context = { completedTasks: [] }) {
    const executionPlan = await resolveTaskExecutionPlan({
      cwd: this.cwd,
      baseTimeoutMs: this.timeoutMs,
      task,
    });

    try {
      const response = await this.client.responses.create(
        {
          model: this.model,
          input: buildTaskPrompt(task, executionPlan, context),
          tools: executionPlan.hints.requiresResearch ? [{ type: "web_search" }] : [],
          text: {
            format: {
              type: "json_schema",
              name: "agent_flow_result",
              strict: true,
              schema: RESULT_SCHEMA,
            },
          },
        },
        {
          timeout: executionPlan.timeoutMs,
        },
      );

      const rawOutput = response.output_text ?? JSON.stringify(response);
      const parsed = extractSdkResult(rawOutput);
      const persistedArtifacts = await writeArtifactFiles({
        cwd: this.cwd,
        defaultArtifactDir: executionPlan.artifactDir,
        fileWrites: parsed.file_writes,
      });

      return {
        status: parsed.status,
        summary: parsed.summary,
        artifacts: dedupeArtifacts([...parsed.artifacts, ...persistedArtifacts]),
        rawOutput,
      };
    } catch (error) {
      return {
        status: "failed",
        summary: error instanceof Error ? error.message : String(error),
        artifacts: [],
        rawOutput: "",
      };
    }
  }
}

export function extractSdkResult(output) {
  let parsed;
  try {
    parsed = JSON.parse(output);
  } catch {
    throw new Error("No valid JSON result found in SDK output.");
  }

  if (!parsed || typeof parsed !== "object" || !parsed.status || !parsed.summary) {
    throw new Error("No valid JSON result found in SDK output.");
  }

  return {
    status: parsed.status === "success" ? "success" : "failed",
    summary: String(parsed.summary),
    artifacts: Array.isArray(parsed.artifacts) ? parsed.artifacts : [],
    file_writes: Array.isArray(parsed.file_writes) ? parsed.file_writes : [],
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

function buildTaskPrompt(task, executionPlan, context) {
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
      ? "Use web_search when you need current or external information."
      : "Do not do unnecessary external research.",
    hints.requiresLocalArtifacts
      ? [
          "If this task should save local output, use file_writes to provide the file contents.",
          `Default output directory: ${executionPlan.relativeArtifactDir}`,
          "For architecture diagrams, prefer Mermaid in a .md or .mmd file unless the task explicitly requires another format.",
        ].join("\n")
      : "Keep file_writes empty unless local files are genuinely needed.",
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

async function writeArtifactFiles({ cwd, defaultArtifactDir, fileWrites }) {
  const saved = [];

  for (const fileWrite of fileWrites) {
    const relativePath = sanitizeArtifactPath(fileWrite.path, defaultArtifactDir, cwd);
    const absolutePath = path.join(cwd, relativePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, fileWrite.content, "utf8");
    saved.push(relativePath);
  }

  return saved;
}

function sanitizeArtifactPath(requestedPath, defaultArtifactDir, cwd) {
  const fallback = path.relative(cwd, path.join(defaultArtifactDir, "artifact.txt"));
  const candidate = requestedPath?.trim() ? requestedPath.trim() : fallback;
  const relative = path.normalize(candidate).replace(/^(\.\.(\/|\\|$))+/, "");
  if (path.isAbsolute(relative) || relative === "") {
    return fallback;
  }
  return relative;
}

function dedupeArtifacts(artifacts) {
  return [...new Set(artifacts.filter(Boolean))];
}

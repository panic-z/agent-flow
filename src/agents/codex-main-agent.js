import { Codex } from "@openai/codex-sdk";

const ACTION_GROUPS = [
  { name: "research", patterns: [/\bresearch\b/i, /\bcollect\b/i, /调研/, /搜集/, /研究/] },
  { name: "shortlist", patterns: [/\bshortlist\b/i, /\bselect\b/i, /\bpick\b/i, /\btop\s*\d+\b/i, /筛选/, /挑选/] },
  { name: "analyze", patterns: [/\banaly[sz]e\b/i, /\bcompare\b/i, /分析/, /对比/, /比较/] },
  { name: "generate", patterns: [/\bgenerate\b/i, /\bcreate\b/i, /\bdraw\b/i, /\bdiagram\b/i, /生成/, /绘制/, /画出/, /架构图/] },
  { name: "save", patterns: [/\bsave\b/i, /\bexport\b/i, /\bwrite\b/i, /保存/, /导出/, /写入/] },
];
const PER_ENTITY_EXPANSION_HINTS = [
  /\bfor each\b/i,
  /\beach\b/i,
  /\bevery\b/i,
  /\bper\b/i,
  /\bfor both\b/i,
  /\bboth of them\b/i,
  /\bthem both\b/i,
  /\bthe two of them\b/i,
  /\bfor the two\b/i,
  /\bthe two\b/i,
  /\bfor the pair\b/i,
  /\bthe pair\b/i,
  /\bfor the duo\b/i,
  /\bthe duo\b/i,
  /每个/,
  /各个/,
  /分别/,
  /给二者/,
  /这两个/,
  /那两个/,
  /二者都/,
  /两个都/,
  /这俩/,
  /那俩/,
  /它们两个/,
  /这俩都/,
  /那俩都/,
];
const SHORTLIST_PATTERNS = [/\bshortlist\b/i, /\btop\s*\d+\b/i, /\bselect\b/i, /\bpick\b/i, /筛选/, /挑选/];
const CLARIFICATION_PROMPT =
  "I could not confidently determine the task breakdown. Please rewrite the todo list with clearer task boundaries.";
const ENTITY_TERMS_PATTERN = "(?:框架|framework|frameworks|agent|agents|tool|tools|provider|providers|library|libraries|model|models|service|services|repo|repos|project|projects|dataset|datasets|api|apis)";
const ENTITY_TERM_CANONICAL_MAP = new Map([
  ["框架", "framework"],
  ["framework", "framework"],
  ["frameworks", "framework"],
  ["agent", "agent"],
  ["agents", "agent"],
  ["tool", "tool"],
  ["tools", "tool"],
  ["provider", "provider"],
  ["providers", "provider"],
  ["library", "library"],
  ["libraries", "library"],
  ["model", "model"],
  ["models", "model"],
  ["service", "service"],
  ["services", "service"],
  ["repo", "repo"],
  ["repos", "repo"],
  ["project", "project"],
  ["projects", "project"],
  ["dataset", "dataset"],
  ["datasets", "dataset"],
  ["api", "api"],
  ["apis", "api"],
]);
const ENGLISH_COUNT_WORDS = new Map([
  ["one", 1],
  ["two", 2],
  ["both", 2],
  ["three", 3],
  ["four", 4],
  ["five", 5],
  ["six", 6],
  ["seven", 7],
  ["eight", 8],
  ["nine", 9],
  ["ten", 10],
]);

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

const REPLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: {
      type: "string",
    },
    pendingTasks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: {
            type: "integer",
            minimum: 0,
          },
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
        required: ["id", "title", "details", "dependsOn", "onDependencyFailure", "dependencyFailurePrompt"],
      },
    },
  },
  required: ["summary", "pendingTasks"],
};

export class CodexMainAgent {
  constructor({
    codexClient,
    cwd = process.cwd(),
    model = "gpt-5.4",
    timeoutMs = 900_000,
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
      const firstPass = await runAnalysisTurn({
        thread,
        prompt: buildAnalysisPrompt(input),
        signal,
      });
      if (!firstPass.ok) {
        return fallbackClarification();
      }
      if (firstPass.analysis.needsClarification) {
        return firstPass.analysis;
      }
      if (passesBreakdownQualityGate(input, firstPass.analysis)) {
        return firstPass.analysis;
      }

      const retryPass = await runAnalysisTurn({
        thread,
        prompt: buildRetryPrompt(input, firstPass.analysis),
        signal,
      });
      if (!retryPass.ok) {
        return fallbackClarification();
      }
      if (retryPass.analysis.needsClarification) {
        return retryPass.analysis;
      }
      if (passesBreakdownQualityGate(input, retryPass.analysis)) {
        return retryPass.analysis;
      }

      return fallbackClarification(
        "I still could not confidently separate this request into smaller flat tasks. Please rewrite the todo list with clearer task boundaries.",
      );
    } catch (error) {
      if (this.shutdownController.signal.aborted) {
        throw new Error("Execution interrupted.");
      }
      return fallbackClarification();
    }
  }

  async replanRemainingTasks(context) {
    const signal = anySignal([AbortSignal.timeout(this.timeoutMs), this.shutdownController.signal]);
    const thread = this.getThread();

    try {
      const turn = await thread.run(buildReplanPrompt(context), {
        outputSchema: REPLAN_SCHEMA,
        signal,
      });
      return normalizeReplan(turn.finalResponse);
    } catch (error) {
      if (this.shutdownController.signal.aborted) {
        throw new Error("Execution interrupted.");
      }
      return {
        summary: "Replanning failed. Keeping the existing pending tasks.",
        pendingTasks: context.pendingTasks ?? [],
      };
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
    "If the input is clear, split it into an ordered list of executable tasks and default to smaller flat tasks.",
    "Each task must represent one primary action.",
    "If a request sentence contains multiple actions, split it into multiple tasks unless the actions are inseparable.",
    "Preserve ordering and dependencies with dependsOn, but keep the result flat and never create nested subtasks.",
    "When a request refers to a set of entities or says things like each, every, per, multiple, several, 热门, 多个, 若干, 每个, or 各个, prefer object-level expansion.",
    "For object-level expansion, first add an explicit shortlist task, then expand the shortlisted entities into separate per-entity task chains.",
    "If the user specifies a quantity, use that quantity for the shortlist. Otherwise default to Top 3 shortlisted entities.",
    "Prefer per-entity chains like analyze entity A -> generate entity A diagram -> save entity A output.",
    "Do not collapse research, shortlist, analysis, generation, and saving into one task.",
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

function buildRetryPrompt(input, previousAnalysis) {
  const previousTasks = previousAnalysis.tasks.map((task) => {
    const dependsOn = task.dependsOn.length > 0 ? task.dependsOn.join(", ") : "(none)";
    return `- ${task.id}. ${task.title} [dependsOn: ${dependsOn}]`;
  }).join("\n");

  return [
    buildAnalysisPrompt(input),
    "",
    "The previous plan was still too coarse.",
    "Retry the analysis and split more aggressively.",
    "You must explicitly add a shortlist task before any per-entity tasks when the request covers a set of entities.",
    "You must expand shortlisted entities into separate flat per-entity task chains when the request asks for work on each entity.",
    "If the user did not specify a quantity, default to Top 3 shortlisted entities.",
    "Do not return one combined task for research + shortlist + analysis + diagram + save.",
    "Previous coarse plan:",
    previousTasks || "- (none)",
  ].join("\n");
}

function buildReplanPrompt(context) {
  return [
    "You are the main agent in a multi-agent orchestrator demo.",
    "A child task just completed. Replan only the remaining pending tasks and return strict JSON only.",
    "Do not modify completed tasks or currently running tasks.",
    "You may keep, remove, reorder, or add pending tasks.",
    "For existing pending tasks that remain, preserve their current id.",
    "For newly added tasks, set id to 0 so the orchestrator can assign the final id.",
    "New tasks may depend only on completed tasks, currently running tasks, or preserved pending-task ids.",
    "Return only the remaining pending tasks. Do not repeat completed or running tasks.",
    "Original user request:",
    context.sessionContext?.originalRequest || context.originalInput || "(not available)",
    "",
    "Just completed task:",
    formatReplanTask(context.justCompletedTask),
    "",
    "Completed task results:",
    formatReplanTaskList(context.completedTasks),
    "",
    "Currently running tasks:",
    formatReplanTaskList(context.runningTasks),
    "",
    "Pending tasks before replanning:",
    formatReplanTaskList(context.pendingTasks),
  ].join("\n");
}

async function runAnalysisTurn({ thread, prompt, signal }) {
  const turn = await thread.run(prompt, {
    outputSchema: ANALYSIS_SCHEMA,
    signal,
  });

  return normalizeAnalysis(turn.finalResponse);
}

function normalizeReplan(output) {
  let parsed;
  try {
    parsed = JSON.parse(output);
  } catch {
    throw new Error("No valid JSON result found in replan output.");
  }

  const pendingTasks = Array.isArray(parsed.pendingTasks)
    ? parsed.pendingTasks
        .filter((task) => task && task.title && task.details)
        .map((task) => ({
          ...(Number.isInteger(task.id) && task.id > 0 ? { id: task.id } : {}),
          title: task.title.trim(),
          details: task.details.trim(),
          dependsOn: Array.isArray(task.dependsOn)
            ? task.dependsOn.filter((dependencyId) => Number.isInteger(dependencyId) && dependencyId > 0)
            : [],
          onDependencyFailure: normalizeDependencyPolicy(task.onDependencyFailure),
          dependencyFailurePrompt:
            typeof task.dependencyFailurePrompt === "string" ? task.dependencyFailurePrompt.trim() : "",
        }))
    : [];

  return {
    summary: typeof parsed.summary === "string" ? parsed.summary : "Updated remaining work.",
    pendingTasks,
  };
}

function formatReplanTask(task) {
  if (!task) {
    return "(none)";
  }

  return [
    `#${task.id} ${task.title}`,
    `details: ${task.details || "(none)"}`,
    `status: ${task.status || "pending"}`,
    `dependsOn: ${Array.isArray(task.dependsOn) && task.dependsOn.length > 0 ? task.dependsOn.join(", ") : "(none)"}`,
    `resultSummary: ${task.resultSummary || "(none)"}`,
  ].join("\n");
}

function formatReplanTaskList(tasks) {
  if (!Array.isArray(tasks) || tasks.length === 0) {
    return "(none)";
  }

  return tasks.map((task) => formatReplanTask(task)).join("\n\n");
}

function normalizeAnalysis(output) {
  let parsed;
  try {
    parsed = JSON.parse(output);
  } catch {
    return { ok: false, analysis: fallbackClarification() };
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
    ok: true,
    analysis: {
      summary: typeof parsed.summary === "string" ? parsed.summary : `I interpreted your request as ${tasks.length} task${tasks.length === 1 ? "" : "s"}.`,
      needsClarification: Boolean(parsed.needsClarification),
      clarificationPrompt: typeof parsed.clarificationPrompt === "string" ? parsed.clarificationPrompt : "",
      tasks,
    },
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

function passesBreakdownQualityGate(input, analysis) {
  if (analysis.needsClarification) {
    return true;
  }
  if (!Array.isArray(analysis.tasks) || analysis.tasks.length === 0) {
    return false;
  }
  if (analysis.tasks.some(isCoarseCompoundTask)) {
    return false;
  }
  if (!matchesExplicitShortlistQuantity(input, analysis.tasks)) {
    return false;
  }
  if (expectsEntityExpansion(input) && !hasExplicitShortlistAndEntityChains(analysis.tasks)) {
    return false;
  }
  return true;
}

function isCoarseCompoundTask(task) {
  const combinedText = `${task.title} ${task.details}`;
  const matchedGroups = ACTION_GROUPS.filter((group) => group.patterns.some((pattern) => pattern.test(combinedText)));
  const looksBundled = /\band\b/i.test(combinedText)
    || /\bthen\b/i.test(combinedText)
    || /并/.test(combinedText)
    || /以及/.test(combinedText)
    || /后保存/.test(combinedText)
    || /后输出/.test(combinedText);

  return matchedGroups.length >= 3 || (matchedGroups.length >= 2 && looksBundled);
}

function expectsEntityExpansion(input) {
  return PER_ENTITY_EXPANSION_HINTS.some((pattern) => pattern.test(input));
}

function hasExplicitShortlistAndEntityChains(tasks) {
  const shortlistIndex = tasks.findIndex((task) => SHORTLIST_PATTERNS.some((pattern) => pattern.test(`${task.title} ${task.details}`)));
  if (shortlistIndex === -1) {
    return false;
  }

  const shortlistTaskId = shortlistIndex + 1;
  const shortlistCount = extractShortlistCount(tasks[shortlistIndex]);
  const postShortlistTasks = tasks.slice(shortlistIndex + 1);
  const branchRoots = postShortlistTasks.filter((task) => task.dependsOn.includes(shortlistTaskId));
  if (branchRoots.length === 0) {
    return false;
  }

  const chainRoots = branchRoots.filter((root) => {
    const chainIds = new Set([root.id]);
    let foundChild = false;

    for (const task of postShortlistTasks) {
      if (task.id === root.id) {
        continue;
      }
      if (task.dependsOn.length !== 1) {
        continue;
      }

      if (chainIds.has(task.dependsOn[0])) {
        chainIds.add(task.id);
        foundChild = true;
      }
    }

    return foundChild;
  });

  if (chainRoots.length === 0) {
    return false;
  }
  if (shortlistCount !== null && chainRoots.length < shortlistCount) {
    return false;
  }

  return true;
}

function matchesExplicitShortlistQuantity(input, tasks) {
  const requestedCount = extractRequestedEntityCount(input);
  if (requestedCount === null) {
    return true;
  }

  const shortlistTask = tasks.find((task) => SHORTLIST_PATTERNS.some((pattern) => pattern.test(`${task.title} ${task.details}`)));
  if (!shortlistTask) {
    return false;
  }

  return extractShortlistCount(shortlistTask) === requestedCount;
}

function extractRequestedEntityCount(input) {
  if (typeof input !== "string") {
    return null;
  }

  const shortlistContextCount = extractCountFromText(input, { requireShortlistContext: true });
  if (shortlistContextCount !== null) {
    return shortlistContextCount;
  }
  if (!expectsEntityExpansion(input)) {
    return null;
  }

  const directEntityCount = extractDirectEntityCount(input);
  if (!directEntityCount) {
    return null;
  }

  if (hasPronounEntityExpansion(input)) {
    return directEntityCount.count;
  }

  const expandedEntityTerms = extractExpandedEntityTerms(input);
  if (!expandedEntityTerms.has(directEntityCount.entity)) {
    return null;
  }

  return directEntityCount.count;
}

function extractShortlistCount(task) {
  if (!task) {
    return null;
  }

  const combinedText = `${task.title} ${task.details}`;
  return extractCountFromText(combinedText, { requireShortlistContext: false });
}

function extractCountFromText(text, { requireShortlistContext }) {
  if (typeof text !== "string") {
    return null;
  }

  const topMatch = text.match(/\btop\s*(\d+)\b/i);
  if (topMatch) {
    return normalizeCountToken(topMatch[1]);
  }
  const topWordMatch = text.match(/\btop\s*(one|two|three|four|five|six|seven|eight|nine|ten)\b/i);
  if (topWordMatch) {
    return normalizeCountToken(topWordMatch[1]);
  }

  const shortlistEntityRegex = new RegExp(
    String.raw`(?:筛选|挑选|select|pick|shortlist)[^\n]{0,30}?([0-9一二两三四五六七八九十]+|one|two|both|three|four|five|six|seven|eight|nine|ten)\s*个?\s*${ENTITY_TERMS_PATTERN}`,
    "i",
  );
  const shortlistEntityMatch = text.match(shortlistEntityRegex);
  if (shortlistEntityMatch) {
    return normalizeCountToken(shortlistEntityMatch[1]);
  }

  const leadingEntityRegex = new RegExp(
    String.raw`前\s*([0-9一二两三四五六七八九十]+)\s*个?\s*${ENTITY_TERMS_PATTERN}`,
    "i",
  );
  const leadingEntityMatch = text.match(leadingEntityRegex);
  if (leadingEntityMatch) {
    return normalizeCountToken(leadingEntityMatch[1]);
  }

  const ordinalEntityRegex = new RegExp(
    String.raw`(?:first|top)\s+(one|two|three|four|five|six|seven|eight|nine|ten)\s+${ENTITY_TERMS_PATTERN}`,
    "i",
  );
  const ordinalEntityMatch = text.match(ordinalEntityRegex);
  if (ordinalEntityMatch) {
    return normalizeCountToken(ordinalEntityMatch[1]);
  }

  const bothEntityRegex = new RegExp(
    String.raw`\bboth\s+${ENTITY_TERMS_PATTERN}`,
    "i",
  );
  if (bothEntityRegex.test(text)) {
    return 2;
  }

  if (requireShortlistContext) {
    return null;
  }

  const genericEntityCountRegex = new RegExp(
    String.raw`([0-9一二两三四五六七八九十]+|one|two|both|three|four|five|six|seven|eight|nine|ten)\s*个?\s*${ENTITY_TERMS_PATTERN}`,
    "i",
  );
  const genericEntityCountMatch = text.match(genericEntityCountRegex);
  if (genericEntityCountMatch) {
    return normalizeCountToken(genericEntityCountMatch[1]);
  }

  return null;
}

function extractDirectEntityCount(text) {
  const directEntityCountRegex = new RegExp(
    String.raw`([0-9一二两三四五六七八九十]+|one|two|both|three|four|five|six|seven|eight|nine|ten)\s*个?\s*(${ENTITY_TERMS_PATTERN})`,
    "i",
  );
  const match = text.match(directEntityCountRegex);
  if (!match) {
    return null;
  }

  const count = normalizeCountToken(match[1]);
  const entity = normalizeEntityTerm(match[2]);
  if (count === null || entity === null) {
    return null;
  }

  return { count, entity };
}

function extractExpandedEntityTerms(text) {
  const expandedTerms = new Set();
  const expansionPatterns = [
    new RegExp(String.raw`(?:for each|each|every|per|每个|各个|分别)[^\n]{0,30}?(${ENTITY_TERMS_PATTERN})`, "ig"),
    new RegExp(String.raw`(${ENTITY_TERMS_PATTERN})[^\n]{0,15}?(?:分别)`, "ig"),
  ];

  for (const pattern of expansionPatterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const entity = normalizeEntityTerm(match[1]);
      if (entity !== null) {
        expandedTerms.add(entity);
      }
    }
  }

  return expandedTerms;
}

function hasPronounEntityExpansion(text) {
  if (typeof text !== "string") {
    return false;
  }

  return [
    /\beach one\b/i,
    /\beach of them\b/i,
    /\beach\b[^\n]{0,20}\bthem\b/i,
    /\bfor both\b/i,
    /\bboth of them\b/i,
    /\bthem both\b/i,
    /\bthe two of them\b/i,
    /\bfor the two\b/i,
    /\bthe two\b/i,
    /\bfor the pair\b/i,
    /\bthe pair\b/i,
    /\bfor the duo\b/i,
    /\bthe duo\b/i,
    /每一个/,
    /给二者/,
    /这两个/,
    /那两个/,
    /二者都/,
    /它们分别/,
    /这俩/,
    /那俩/,
    /两个都/,
    /它们两个/,
    /这俩都/,
    /那俩都/,
    /分别处理它们/,
  ].some((pattern) => pattern.test(text));
}

function normalizeEntityTerm(term) {
  if (typeof term !== "string" || term.length === 0) {
    return null;
  }

  return ENTITY_TERM_CANONICAL_MAP.get(term.toLowerCase()) ?? null;
}

function normalizeCountToken(token) {
  if (typeof token !== "string" || token.length === 0) {
    return null;
  }

  const numericCount = Number.parseInt(token, 10);
  if (Number.isInteger(numericCount) && numericCount > 0) {
    return numericCount;
  }

  const englishCount = ENGLISH_COUNT_WORDS.get(token.toLowerCase());
  if (englishCount) {
    return englishCount;
  }

  const chineseCount = parseChineseCount(token);
  if (Number.isInteger(chineseCount) && chineseCount > 0) {
    return chineseCount;
  }

  return null;
}

function parseChineseCount(token) {
  const numerals = new Map([
    ["一", 1],
    ["二", 2],
    ["两", 2],
    ["三", 3],
    ["四", 4],
    ["五", 5],
    ["六", 6],
    ["七", 7],
    ["八", 8],
    ["九", 9],
  ]);

  if (numerals.has(token)) {
    return numerals.get(token);
  }
  if (token === "十") {
    return 10;
  }
  if (token.startsWith("十") && token.length === 2 && numerals.has(token.slice(1))) {
    return 10 + numerals.get(token.slice(1));
  }
  if (token.endsWith("十") && token.length === 2 && numerals.has(token[0])) {
    return numerals.get(token[0]) * 10;
  }
  if (token.length === 3 && token[1] === "十" && numerals.has(token[0]) && numerals.has(token[2])) {
    return numerals.get(token[0]) * 10 + numerals.get(token[2]);
  }

  const count = Number.parseInt(token, 10);
  return Number.isInteger(count) && count > 0 ? count : null;
}

function fallbackClarification(clarificationPrompt = CLARIFICATION_PROMPT) {
  return {
    summary: "I need clarification before I can build a reliable execution plan.",
    needsClarification: true,
    clarificationPrompt,
    tasks: [],
  };
}

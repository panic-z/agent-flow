import fs from "node:fs/promises";
import path from "node:path";

export async function runApp({
  args,
  prompt,
  write,
  createMainAgent,
  createRunner,
  sessionContext,
  cwd = process.cwd(),
  maxConcurrency = 5,
  heartbeatMs = 15_000,
  createInterval = globalThis.setInterval,
  clearInterval = globalThis.clearInterval,
}) {
  const initialText = args.length > 0 ? args.join(" ") : await prompt("Enter todo list: ");
  const analysisInput = buildAnalysisInput(initialText, sessionContext);
  const statePaths = getExecutionPaths(cwd);
  const resumedState = await loadResumableState(statePaths.progressPath, initialText);

  let confirmedTasks;
  let summaryText;
  let originalInput;
  let startedAt;
  let mainAgent;
  let runner;

  try {
    if (resumedState) {
      write(`${formatInfo(`[Resume] Resuming from ${statePaths.relativeProgressPath}`)}\n`);
      confirmedTasks = resumedState.tasks;
      summaryText = resumedState.summary;
      originalInput = resumedState.originalInput;
      startedAt = resumedState.startedAt;
    } else {
      write(`${formatStage("Stage 1/4: analyzing your todo list.")}\n`);
      mainAgent = await createMainAgent();
      const analysis = await mainAgent.analyzeTodo(analysisInput);
      if (analysis.tasks.length === 0 && !analysis.needsClarification) {
        write(`${formatWarning("No tasks provided.")}\n`);
        return { exitCode: 1, tasks: [] };
      }

      const confirmation = await confirmTasks({
        analysis,
        initialText,
        prompt,
        write,
        mainAgent,
        sessionContext,
      });
      confirmedTasks = confirmation.tasks;
      summaryText = confirmation.summary;
      originalInput = initialText;
      startedAt = new Date().toISOString();
      await saveExecutionPlan({
        planPath: statePaths.planPath,
        relativePlanPath: statePaths.relativePlanPath,
        originalInput,
        summary: summaryText,
        tasks: confirmedTasks,
        write,
      });
      await persistExecutionState({
        progressPath: statePaths.progressPath,
        relativeProgressPath: statePaths.relativeProgressPath,
        originalInput,
        startedAt,
        summary: summaryText,
        tasks: confirmedTasks,
        runStatus: "in_progress",
        currentTaskId: null,
        currentTaskTitle: "",
        write,
      });
    }

    if (!mainAgent) {
      mainAgent = await createMainAgent();
    }

    write(`\n${formatStage("Stage 3/4: initializing sub-agent runner.")}\n`);
    runner = await createRunner();

    write(`${formatStage("Stage 4/4: executing tasks.")}\n`);
    const initialCompletedCount = countCompletedTasks(confirmedTasks);
    const initialSuccessCount = countTasksByStatus(confirmedTasks, "success");
    const initialFailureCount = countCompletedTasks(confirmedTasks) - initialSuccessCount;
    write(`${formatProgress(`[Progress] ${initialCompletedCount}/${confirmedTasks.length} tasks finished.`)}\n`);
    write(`${formatInfo("Starting sub-agents...")}\n`);
    const summary = await runTaskLoop({
      tasks: confirmedTasks,
      runner,
      mainAgent,
      prompt,
      write,
      originalInput,
      sessionContext,
      startedAt,
      summaryText,
      progressPath: statePaths.progressPath,
      relativeProgressPath: statePaths.relativeProgressPath,
      maxConcurrency,
      heartbeatMs,
      createInterval,
      clearInterval,
      initialSuccessCount,
      initialFailureCount,
    });

    write(`\n${formatStage("Final summary:")}\n`);
    for (const task of summary.tasks) {
      write(`- ${formatTaskStatus(task.status)} ${task.title}: ${task.resultSummary}\n`);
    }
    write(`${formatTotals(summary.successCount, summary.failureCount)}\n`);

    return {
      exitCode: summary.failureCount > 0 ? 1 : 0,
      tasks: summary.tasks,
      sessionContext: buildSessionContext({
        initialText,
        sessionContext,
        tasks: summary.tasks,
      }),
    };
  } finally {
    mainAgent?.shutdown?.();
    runner?.shutdown?.();
  }
}

async function confirmTasks({ analysis, initialText, prompt, write, mainAgent, sessionContext }) {
  let currentAnalysis = analysis;
  let currentRequestText = initialText;

  while (true) {
    write(`\n${formatStage("Stage 2/4: waiting for your confirmation.")}\n`);
    if (currentAnalysis.needsClarification) {
      write(`${formatWarning(currentAnalysis.clarificationPrompt)}\n`);
      const replacement = await prompt(`${formatPrompt("Please update the todo list with the clarification above: ")}`);
      currentRequestText = replacement;
      currentAnalysis = await mainAgent.analyzeTodo(buildAnalysisInput(replacement, sessionContext));
      if (currentAnalysis.tasks.length === 0) {
        write(`${formatWarning("No tasks detected, please try again.")}\n`);
      }
      continue;
    }

    if (currentAnalysis.tasks.length === 0) {
      write(`${formatWarning("No tasks detected, please try again.")}\n`);
      const feedback = await prompt(`${formatPrompt("Describe the task or how to adjust the plan: ")}`);
      currentAnalysis = await mainAgent.analyzeTodo(buildPlanRevisionInput({
        originalRequest: currentRequestText,
        currentAnalysis,
        userFeedback: feedback,
        sessionContext,
      }));
      continue;
    }

    write(`\n${formatInfo(currentAnalysis.summary)}\n`);
    write(`${formatHeader("Proposed execution plan:")}\n`);
    for (const task of currentAnalysis.tasks) {
      write(`${task.id}. ${task.title}\n`);
    }
    write(`${formatInfo('You can accept this plan, or reply with edits like "split task 2", "change the order", or "remove the save step".')}\n`);
    const executionWaves = buildExecutionWaves(currentAnalysis.tasks);
    if (executionWaves.length > 0) {
      write(`${formatHeader("Parallel execution plan:")}\n`);
      write(`${formatInfo("Tasks in the same wave will run in parallel. Later waves will wait for their dependencies.")}\n`);
      for (const [index, wave] of executionWaves.entries()) {
        const label = wave.length > 1 ? `Wave ${index + 1} (parallel)` : `Wave ${index + 1}`;
        const taskList = wave.map((task) => `${task.id}. ${task.title}`).join(" | ");
        write(`${label}: ${taskList}\n`);
      }
    }

    const answer = (await prompt(`${formatPrompt("Press Enter to accept, type yes to continue, or describe what to change: ")}`)).trim();
    const normalizedAnswer = answer.toLowerCase();
    if (normalizedAnswer === "" || normalizedAnswer === "yes" || normalizedAnswer === "y") {
      return {
        tasks: currentAnalysis.tasks,
        summary: currentAnalysis.summary,
      };
    }

    const feedback = normalizedAnswer === "no"
      ? await prompt(`${formatPrompt("Tell me how you want to adjust this plan: ")}`)
      : answer;

    currentAnalysis = await mainAgent.analyzeTodo(buildPlanRevisionInput({
      originalRequest: currentRequestText,
      currentAnalysis,
      userFeedback: feedback,
      sessionContext,
    }));
    if (currentAnalysis.tasks.length === 0) {
      write(`${formatWarning("No tasks detected, please try again.")}\n`);
    }
  }
}

function buildPlanRevisionInput({ originalRequest, currentAnalysis, userFeedback, sessionContext }) {
  const currentPlan = currentAnalysis.tasks
    .map((task) => {
      const dependsOn = Array.isArray(task.dependsOn) && task.dependsOn.length > 0
        ? task.dependsOn.join(", ")
        : "(none)";
      return `- ${task.id}. ${task.title} [dependsOn: ${dependsOn}]`;
    })
    .join("\n");

  const baseSections = [
    sessionContext?.originalRequest ? "Current round request:" : "Original user request:",
    originalRequest || "(not available)",
    "",
    "Current proposed plan:",
    currentPlan,
    "",
    "User feedback on the current plan:",
    userFeedback,
    "",
    "Revise the current plan based on the feedback above.",
    "Return a new flat task plan in the same structured format as before.",
  ];

  if (!sessionContext?.originalRequest || !Array.isArray(sessionContext.latestRoundTasks) || sessionContext.latestRoundTasks.length === 0) {
    return baseSections.join("\n");
  }

  return [
    "Session original request:",
    sessionContext.originalRequest,
    "",
    "Previous round results:",
    sessionContext.latestRoundTasks
      .map((task) => {
        const status = typeof task.status === "string" ? task.status : "unknown";
        const title = task.title || `Task ${task.id ?? ""}`.trim();
        const summary = task.resultSummary || "(no result summary)";
        return `- [${status}] ${title}: ${summary}`;
      })
      .join("\n"),
    "",
    ...baseSections,
  ].join("\n");
}

function buildAnalysisInput(initialText, sessionContext) {
  if (!sessionContext?.originalRequest || !Array.isArray(sessionContext.latestRoundTasks) || sessionContext.latestRoundTasks.length === 0) {
    return initialText;
  }

  const previousRoundResults = sessionContext.latestRoundTasks
    .map((task) => {
      const status = typeof task.status === "string" ? task.status : "unknown";
      const title = task.title || `Task ${task.id ?? ""}`.trim();
      const summary = task.resultSummary || "(no result summary)";
      return `- [${status}] ${title}: ${summary}`;
    })
    .join("\n");

  return [
    "Session original request:",
    sessionContext.originalRequest,
    "",
    "Previous round results:",
    previousRoundResults,
    "",
    "New user follow-up:",
    initialText,
    "",
    "Based on the full session context above, produce a new flat task plan for this follow-up only.",
  ].join("\n");
}

function buildSessionContext({ initialText, sessionContext, tasks }) {
  const originalRequest = sessionContext?.originalRequest || initialText;
  return {
    originalRequest,
    latestRoundTasks: tasks.map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      resultSummary: task.resultSummary,
    })),
  };
}

async function runTaskLoop({
  tasks,
  runner,
  mainAgent,
  prompt,
  write,
  originalInput,
  sessionContext,
  startedAt,
  summaryText,
  progressPath,
  relativeProgressPath,
  maxConcurrency,
  heartbeatMs,
  createInterval,
  clearInterval,
  initialSuccessCount = 0,
  initialFailureCount = 0,
}) {
  const completedTasks = tasks
    .filter((task) => isCompletedStatus(task.status))
    .map((task) => normalizePersistedTask(task));
  const runningTasks = new Map();
  let successCount = initialSuccessCount;
  let failureCount = initialFailureCount;
  let total = tasks.length;
  let processedCompletedCount = completedTasks.length;

  for (const task of tasks) {
    if (task.status === "running") {
      task.status = "pending";
    }
  }

  while (completedTasks.length < total) {
    let launched = false;
    while (runningTasks.size < maxConcurrency) {
      const readyTask = tasks.find((task) => isTaskReady(task, completedTasks));
      if (!readyTask) {
        break;
      }
      launched = true;
      startTask({
        task: readyTask,
        total,
        runner,
        write,
        completedTasks,
        runningTasks,
        heartbeatMs,
        createInterval,
        clearInterval,
        onSuccess() {
          successCount += 1;
        },
        onFailure() {
          failureCount += 1;
        },
        onPersist: async () => {
          await persistExecutionState({
            progressPath,
            relativeProgressPath,
            originalInput,
            startedAt,
            summary: summaryText,
            tasks,
            runStatus: "in_progress",
            currentTasks: Array.from(runningTasks.values()).map(({ task: runningTask }) => ({
              id: runningTask.id,
              title: runningTask.title,
            })),
            write,
          });
        },
      });
    }

    const blockedTask = tasks.find((task) => isTaskBlocked(task, completedTasks, runningTasks));
    if (blockedTask && runningTasks.size === 0) {
      const action = await handleBlockedTask({
        task: blockedTask,
        completedTasks,
        successCount,
        total,
        prompt,
        write,
        failureCountRef: () => failureCount,
        setFailureCount: (next) => {
          failureCount = next;
        },
      });

      if (action === "abort") {
        await persistExecutionState({
          progressPath,
          relativeProgressPath,
          originalInput,
          startedAt,
          summary: summaryText,
          tasks,
          runStatus: "aborted",
          currentTasks: [],
          write,
        });
        return {
          tasks: completedTasks,
          successCount,
          failureCount: failureCount + (total - completedTasks.length),
        };
      }

      await persistExecutionState({
        progressPath,
        relativeProgressPath,
        originalInput,
        startedAt,
        summary: summaryText,
        tasks,
        runStatus: "in_progress",
        currentTasks: [],
        write,
      });
      continue;
    }

    if (runningTasks.size === 0 && !launched) {
      markUnresolvableTasks(tasks, completedTasks, write);
      failureCount = countTasksByStatus(tasks, "failed");
      successCount = countTasksByStatus(tasks, "success");
      break;
    }

    await Promise.race(Array.from(runningTasks.values(), ({ promise }) => promise));

    while (processedCompletedCount < completedTasks.length) {
      const justCompletedTask = completedTasks[processedCompletedCount];
      processedCompletedCount += 1;

      const pendingTasks = tasks.filter((task) => task.status === "pending");
      if (pendingTasks.length === 0 || typeof mainAgent?.replanRemainingTasks !== "function") {
        continue;
      }

      const replan = await maybeReplanRemainingTasks({
        mainAgent,
        originalInput,
        sessionContext,
        tasks,
        completedTasks,
        runningTasks,
        justCompletedTask,
        write,
      });

      if (!replan) {
        continue;
      }

      total = tasks.length;
      await persistExecutionState({
        progressPath,
        relativeProgressPath,
        originalInput,
        startedAt,
        summary: summaryText,
        tasks,
        runStatus: "in_progress",
        currentTasks: Array.from(runningTasks.values()).map(({ task: runningTask }) => ({
          id: runningTask.id,
          title: runningTask.title,
        })),
        write,
      });
    }
  }

  await persistExecutionState({
    progressPath,
    relativeProgressPath,
    originalInput,
    startedAt,
    summary: summaryText,
    tasks,
    runStatus: "completed",
    currentTasks: [],
    write,
  });

  return {
    tasks: completedTasks,
    successCount,
    failureCount,
  };
}

function startTaskHeartbeat({ task, write, heartbeatMs, createInterval, clearInterval }) {
  if (!heartbeatMs || heartbeatMs <= 0 || typeof createInterval !== "function" || typeof clearInterval !== "function") {
    return () => {};
  }

  let elapsedMs = 0;
  const timerId = createInterval(() => {
    elapsedMs += heartbeatMs;
    write(`${formatHeartbeat(`[Heartbeat] Task #${task.id} has been running for ${Math.round(elapsedMs / 1000)}s.`)}\n`);
  }, heartbeatMs);

  return () => {
    clearInterval(timerId);
  };
}

async function maybeReplanRemainingTasks({
  mainAgent,
  originalInput,
  sessionContext,
  tasks,
  completedTasks,
  runningTasks,
  justCompletedTask,
  write,
}) {
  try {
    const pendingTasks = tasks.filter((task) => task.status === "pending").map((task) => normalizePersistedTask(task));
    const result = await mainAgent.replanRemainingTasks({
      originalInput,
      sessionContext,
      justCompletedTask: normalizePersistedTask(justCompletedTask),
      completedTasks: completedTasks.map((task) => normalizePersistedTask(task)),
      runningTasks: Array.from(runningTasks.values(), ({ task }) => normalizePersistedTask(task)),
      pendingTasks,
    });

    if (!result || !Array.isArray(result.pendingTasks)) {
      return null;
    }

    const mergedTasks = mergeReplannedPendingTasks({
      currentTasks: tasks,
      pendingTasks: result.pendingTasks,
    });

    tasks.splice(0, tasks.length, ...mergedTasks);
    write(`${formatInfo(`[Replan] ${result.summary || "Updated remaining work."}`)}\n`);
    return result;
  } catch (error) {
    write(`${formatWarning(`[Replan] Skipped: ${error instanceof Error ? error.message : String(error)}`)}\n`);
    return null;
  }
}

function startTask({
  task,
  total,
  runner,
  write,
  completedTasks,
  runningTasks,
  heartbeatMs,
  createInterval,
  clearInterval,
  onSuccess,
  onFailure,
  onPersist,
}) {
  task.status = "running";
  write(`${formatRunning(`- Running #${task.id}/${total}: ${task.title}`)}\n`);
  const stopHeartbeat = startTaskHeartbeat({
    task,
    write,
    heartbeatMs,
    createInterval,
    clearInterval,
  });

  const trackedRun = {
    task,
    promise: null,
  };
  runningTasks.set(task.id, trackedRun);

  trackedRun.promise = (async () => {
    await onPersist();
    let result;
    try {
      result = await runner.runTask(task, {
        completedTasks: completedTasks.map((completedTask) => ({
          id: completedTask.id,
          title: completedTask.title,
          details: completedTask.details,
          dependsOn: completedTask.dependsOn ?? [],
          status: completedTask.status,
          resultSummary: completedTask.resultSummary,
          artifacts: completedTask.artifacts ?? [],
        })),
        onLog(message) {
          write(`${formatRunner(`[Runner] ${message}`)}\n`);
        },
      });
    } catch (error) {
      if (isInterruptError(error)) {
        throw error;
      }
      result = {
        status: "failed",
        summary: error instanceof Error ? error.message : String(error),
        artifacts: [],
        rawOutput: "",
      };
    } finally {
      stopHeartbeat();
    }

    task.status = result.status === "success" ? "success" : "failed";
    task.resultSummary = result.summary;
    task.artifacts = result.artifacts ?? [];
    task.rawOutput = result.rawOutput ?? "";
    completedTasks.push(task);
    if (task.status === "success") {
      onSuccess();
    } else {
      onFailure();
    }
  })().finally(() => {
    runningTasks.delete(task.id);
  });

  trackedRun.promise = trackedRun.promise.then(async () => {
    const successCount = countTasksByStatus(completedTasks, "success");
    const failureCount = countTasksByStatus(completedTasks, "failed");
    write(`${formatProgress(`[Progress] ${completedTasks.length}/${total} tasks finished. Success: ${successCount}, Failed: ${failureCount}`)}\n`);
    write(`  -> ${formatResultLabel(task.status)}: ${task.resultSummary}\n`);
    await onPersist();
  });
}

function mergeReplannedPendingTasks({ currentTasks, pendingTasks }) {
  const frozenTasks = currentTasks.filter((task) => task.status !== "pending");
  const existingPendingTasks = currentTasks.filter((task) => task.status === "pending");
  const existingPendingIds = new Set(existingPendingTasks.map((task) => task.id));
  const frozenIds = new Set(frozenTasks.map((task) => task.id));
  const explicitPendingIds = new Set();
  let nextId = currentTasks.reduce((maxId, task) => Math.max(maxId, Number(task.id) || 0), 0) + 1;

  const normalizedPending = pendingTasks.map((task) => {
    if (task.id != null && task.id !== 0) {
      if (frozenIds.has(task.id)) {
        throw new Error(`Task #${task.id} is already running or completed and cannot be replanned.`);
      }
      if (!existingPendingIds.has(task.id)) {
        throw new Error(`Task #${task.id} is not part of the current pending plan.`);
      }
      if (explicitPendingIds.has(task.id)) {
        throw new Error(`Task #${task.id} appears multiple times in the replanned pending work.`);
      }
      explicitPendingIds.add(task.id);
      return normalizeReplannedTask(task, task.id);
    }

    const assignedId = nextId;
    nextId += 1;
    return normalizeReplannedTask(task, assignedId);
  });

  const allowedDependencyIds = new Set([
    ...frozenIds,
    ...normalizedPending.map((task) => task.id),
  ]);

  for (const task of normalizedPending) {
    for (const dependencyId of task.dependsOn) {
      if (!allowedDependencyIds.has(dependencyId)) {
        throw new Error(`Task #${task.id} depends on unknown task #${dependencyId}.`);
      }
    }
  }

  return [...frozenTasks, ...normalizedPending];
}

function normalizeReplannedTask(task, id) {
  return {
    id,
    title: task.title,
    details: task.details,
    dependsOn: Array.isArray(task.dependsOn) ? task.dependsOn : [],
    onDependencyFailure: task.onDependencyFailure ?? "ask_user",
    dependencyFailurePrompt: task.dependencyFailurePrompt ?? "",
    status: "pending",
    resultSummary: "",
    artifacts: [],
    rawOutput: "",
  };
}

async function handleBlockedTask({
  task,
  completedTasks,
  successCount,
  total,
  prompt,
  write,
  failureCountRef,
  setFailureCount,
}) {
  write(`${formatWarning(`Task #${task.id} appears to depend on results from earlier tasks.`)}\n`);
  write(`${formatWarning("The required earlier result is missing because a prior task failed.")}\n`);
  if (task.dependencyFailurePrompt) {
    write(`${formatWarning(task.dependencyFailurePrompt)}\n`);
  }

  const policy = task.onDependencyFailure ?? "ask_user";
  if (policy === "skip") {
    markSkippedTask({ task, completedTasks, failureCountRef, setFailureCount, successCount, total, write });
    return "skip";
  }

  if (policy === "abort") {
    write(`${formatError("Aborting execution based on the main agent's recommendation.")}\n`);
    return "abort";
  }

  const answer = (await prompt(`${formatPrompt("Type 'retry', 'skip', or 'abort': ")}`)).trim().toLowerCase();
  if (answer === "abort") {
    write(`${formatError("Aborting execution based on your instruction.")}\n`);
    return "abort";
  }

  if (answer === "skip") {
    markSkippedTask({ task, completedTasks, failureCountRef, setFailureCount, successCount, total, write });
    return "skip";
  }

  return "retry";
}

function isTaskReady(task, completedTasks) {
  if (task.status !== "pending") {
    return false;
  }

  return dependenciesAreSuccessful(task, completedTasks);
}

function isTaskBlocked(task, completedTasks, runningTasks) {
  if (task.status !== "pending" || task.dependsOn?.some((dependencyId) => runningTasks.has(dependencyId))) {
    return false;
  }

  return dependenciesHaveFailed(task, completedTasks);
}

function dependenciesAreSuccessful(task, completedTasks) {
  const dependsOn = Array.isArray(task.dependsOn) ? task.dependsOn : [];
  return dependsOn.every((dependencyId) => {
    const dependency = completedTasks.find((completedTask) => completedTask.id === dependencyId);
    return isSuccessfulResult(dependency);
  });
}

function dependenciesHaveFailed(task, completedTasks) {
  const dependsOn = Array.isArray(task.dependsOn) ? task.dependsOn : [];
  if (dependsOn.length === 0) {
    return false;
  }

  return dependsOn.every((dependencyId) => isCompletedStatus(completedTasks.find((completedTask) => completedTask.id === dependencyId)?.status))
    && dependsOn.some((dependencyId) => !isSuccessfulResult(completedTasks.find((completedTask) => completedTask.id === dependencyId)));
}

function markUnresolvableTasks(tasks, completedTasks, write) {
  for (const task of tasks) {
    if (task.status !== "pending") {
      continue;
    }
    task.status = "failed";
    task.resultSummary = "Task could not be scheduled because its dependencies never became runnable.";
    task.artifacts = [];
    task.rawOutput = "";
    completedTasks.push(task);
    write(`${formatWarning(`Skipping #${task.id} because its dependencies never became runnable.`)}\n`);
  }
}

function buildExecutionWaves(tasks) {
  const remaining = tasks.map((task) => ({ ...task }));
  const completedIds = new Set();
  const waves = [];

  while (remaining.length > 0) {
    const ready = remaining.filter((task) => {
      const dependsOn = Array.isArray(task.dependsOn) ? task.dependsOn : [];
      return dependsOn.every((dependencyId) => completedIds.has(dependencyId));
    });

    if (ready.length === 0) {
      break;
    }

    waves.push(ready);
    for (const task of ready) {
      completedIds.add(task.id);
    }
    for (const task of ready) {
      const index = remaining.findIndex((candidate) => candidate.id === task.id);
      if (index >= 0) {
        remaining.splice(index, 1);
      }
    }
  }

  return waves;
}

function getExecutionPaths(cwd) {
  const outputDir = path.join(cwd, "outputs");
  const planPath = path.join(outputDir, "execution-plan.md");
  const progressPath = path.join(outputDir, "execution-progress.json");
  return {
    outputDir,
    planPath,
    progressPath,
    relativePlanPath: path.relative(cwd, planPath) || "execution-plan.md",
    relativeProgressPath: path.relative(cwd, progressPath) || "execution-progress.json",
  };
}

async function saveExecutionPlan({ planPath, relativePlanPath, originalInput, summary, tasks, write }) {
  await fs.mkdir(path.dirname(planPath), { recursive: true });
  const lines = [
    "# Execution Plan",
    "",
    `Generated at: ${new Date().toISOString()}`,
    `Original input: ${originalInput}`,
    "",
    "## Summary",
    summary,
    "",
    "## Tasks",
    ...tasks.flatMap((task) => [
      `${task.id}. ${task.title}`,
      `   - details: ${task.details}`,
      `   - dependsOn: ${formatPlanValue(task.dependsOn ?? [])}`,
      `   - onDependencyFailure: ${task.onDependencyFailure ?? "ask_user"}`,
      `   - dependencyFailurePrompt: ${task.dependencyFailurePrompt || "(none)"}`,
    ]),
    "",
  ];
  await fs.writeFile(planPath, `${lines.join("\n")}\n`, "utf8");
  write(`${formatInfo(`[Plan] Saved execution plan to ${relativePlanPath}`)}\n`);
}

async function persistExecutionState({
  progressPath,
  relativeProgressPath,
  originalInput,
  startedAt,
  summary,
  tasks,
  runStatus,
  currentTasks,
  currentTaskId,
  currentTaskTitle,
  write,
}) {
  await fs.mkdir(path.dirname(progressPath), { recursive: true });
  const normalizedCurrentTasks = Array.isArray(currentTasks)
    ? currentTasks.map((task) => ({ id: task.id, title: task.title }))
    : currentTaskId
      ? [{ id: currentTaskId, title: currentTaskTitle ?? "" }]
      : [];
  const state = {
    version: 1,
    originalInput,
    startedAt,
    updatedAt: new Date().toISOString(),
    runStatus,
    currentTaskId: normalizedCurrentTasks[0]?.id ?? null,
    currentTaskTitle: normalizedCurrentTasks[0]?.title ?? "",
    currentTasks: normalizedCurrentTasks,
    summary,
    tasks: tasks.map((task) => normalizePersistedTask(task)),
  };
  await fs.writeFile(progressPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  write(`${formatRunner(`[State] Saved execution progress to ${relativeProgressPath}`)}\n`);
}

async function loadResumableState(progressPath, initialText) {
  try {
    const raw = await fs.readFile(progressPath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.runStatus !== "in_progress" || parsed.originalInput !== initialText || !Array.isArray(parsed.tasks)) {
      return null;
    }

    return {
      originalInput: parsed.originalInput,
      startedAt: typeof parsed.startedAt === "string" ? parsed.startedAt : new Date().toISOString(),
      summary: typeof parsed.summary === "string" ? parsed.summary : "Resuming saved execution state.",
      tasks: parsed.tasks.map((task) => normalizePersistedTask(task)),
    };
  } catch {
    return null;
  }
}

function hasMissingDependencies(task, completedTasks) {
  const dependsOn = Array.isArray(task.dependsOn) ? task.dependsOn : [];
  if (dependsOn.length === 0) {
    return false;
  }

  return dependsOn.some((dependencyId) => {
    const dependency = completedTasks.find((completedTask) => completedTask.id === dependencyId);
    return !isSuccessfulResult(dependency);
  });
}

function isSuccessfulResult(task) {
  return Boolean(task && task.status === "success" && ((task.artifacts?.length ?? 0) > 0 || task.resultSummary));
}

function isCompletedStatus(status) {
  return status === "success" || status === "failed";
}

function normalizePersistedTask(task) {
  return {
    id: task.id,
    title: task.title,
    details: task.details,
    dependsOn: Array.isArray(task.dependsOn) ? task.dependsOn : [],
    onDependencyFailure: task.onDependencyFailure ?? "ask_user",
    dependencyFailurePrompt: task.dependencyFailurePrompt ?? "",
    status: task.status ?? "pending",
    resultSummary: task.resultSummary ?? "",
    artifacts: Array.isArray(task.artifacts) ? task.artifacts : [],
    rawOutput: task.rawOutput ?? "",
  };
}

function countCompletedTasks(tasks) {
  return tasks.filter((task) => isCompletedStatus(task.status)).length;
}

function countTasksByStatus(tasks, status) {
  return tasks.filter((task) => task.status === status).length;
}

function markSkippedTask({ task, completedTasks, failureCountRef, setFailureCount, successCount, total, write }) {
  task.status = "failed";
  task.resultSummary = `Skipped #${task.id} based on your instruction.`;
  task.artifacts = [];
  task.rawOutput = "";
  completedTasks.push(task);
  const nextFailureCount = failureCountRef() + 1;
  setFailureCount(nextFailureCount);
  write(`${formatWarning(`Skipping #${task.id} based on your instruction.`)}\n`);
  write(`${formatProgress(`[Progress] ${completedTasks.length}/${total} tasks finished. Success: ${successCount}, Failed: ${nextFailureCount}`)}\n`);
}

function formatStage(text) {
  return color(text, [1, 36]);
}

function formatHeader(text) {
  return color(text, [1, 37]);
}

function formatInfo(text) {
  return color(text, [37]);
}

function formatPrompt(text) {
  return color(text, [1, 33]);
}

function formatWarning(text) {
  return color(text, [33]);
}

function formatError(text) {
  return color(text, [1, 31]);
}

function formatProgress(text) {
  return color(text, [1, 34]);
}

function formatRunning(text) {
  return color(text, [36]);
}

function formatRunner(text) {
  return color(text, [35]);
}

function formatHeartbeat(text) {
  return color(text, [2, 36]);
}

function formatTaskStatus(status) {
  if (status === "success") {
    return color("[success]", [32]);
  }
  if (status === "failed") {
    return color("[failed]", [31]);
  }
  return color(`[${status}]`, [33]);
}

function formatResultLabel(status) {
  return status === "success" ? color("SUCCESS", [1, 32]) : color("FAILED", [1, 31]);
}

function formatTotals(successCount, failureCount) {
  return `${color(`Success: ${successCount}`, [32])}, ${color(`Failed: ${failureCount}`, [31])}`;
}

function color(text, codes) {
  return `\x1b[${codes.join(";")}m${text}\x1b[0m`;
}

function formatPlanValue(value) {
  return Array.isArray(value) && value.length > 0 ? value.join(", ") : "(none)";
}

function isInterruptError(error) {
  return error instanceof Error && /Execution interrupted/.test(error.message);
}

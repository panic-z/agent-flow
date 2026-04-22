export async function runOrchestrator({
  tasks,
  runner,
  onTaskStart = () => {},
  onTaskFinish = () => {},
  onProgress = () => {},
}) {
  const results = [];
  let successCount = 0;
  let failureCount = 0;
  const total = tasks.length;

  for (const task of tasks) {
    task.status = "running";
    onProgress({
      phase: "start",
      completed: results.length,
      total,
      taskId: task.id,
      successCount,
      failureCount,
    });
    onTaskStart(task);

    let result;
    try {
      result = await runner.runTask(task, {
        completedTasks: results.map((completedTask) => ({
          id: completedTask.id,
          title: completedTask.title,
          details: completedTask.details,
          status: completedTask.status,
          resultSummary: completedTask.resultSummary,
          artifacts: completedTask.artifacts ?? [],
        })),
      });
    } catch (error) {
      result = {
        status: "failed",
        summary: error instanceof Error ? error.message : String(error),
        artifacts: [],
        rawOutput: "",
      };
    }

    task.status = result.status === "success" ? "success" : "failed";
    task.resultSummary = result.summary;
    task.artifacts = result.artifacts ?? [];
    task.rawOutput = result.rawOutput ?? "";
    results.push(task);
    if (task.status === "success") {
      successCount += 1;
    } else {
      failureCount += 1;
    }
    onProgress({
      phase: "finish",
      completed: results.length,
      total,
      taskId: task.id,
      successCount,
      failureCount,
    });
    onTaskFinish(task, result);
  }

  return {
    tasks: results,
    successCount,
    failureCount,
  };
}

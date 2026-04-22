export class FakeRunner {
  constructor(results = []) {
    this.results = results;
    this.calls = [];
  }

  async runTask(task) {
    this.calls.push(task.title);
    const next = this.results.shift() ?? {
      status: "success",
      summary: `Completed ${task.title}`,
      artifacts: [],
      rawOutput: "",
    };
    return next;
  }
}

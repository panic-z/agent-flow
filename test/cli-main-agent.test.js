import test from "node:test";
import assert from "node:assert/strict";

import { CodexMainAgent } from "../src/agents/codex-main-agent.js";
import { createMainAgentFromEnv } from "../src/cli.js";

test("createMainAgentFromEnv returns a Codex main agent by default", async () => {
  const agent = await createMainAgentFromEnv({
    env: {},
  });

  assert.ok(agent instanceof CodexMainAgent);
});

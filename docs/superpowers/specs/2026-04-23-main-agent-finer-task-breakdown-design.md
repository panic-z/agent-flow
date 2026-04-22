# Main Agent Finer Task Breakdown Design

## Goal

Make the main agent split user requests into finer flat tasks by default, without introducing nested task hierarchies or per-entity task explosion.

The desired behavior is an "aggressive split" strategy:

- If a request contains multiple distinct actions, prefer multiple tasks over one combined task.
- Keep tasks flat and ordered.
- Preserve dependency information so the orchestrator can still schedule tasks safely.

## Scope

In scope:

- Strengthen the main-agent prompt so it prefers smaller single-action tasks.
- Add a local task-breakdown quality check after the model returns its plan.
- Re-run analysis once when the returned plan is still too coarse.
- Fall back to clarification when the plan still cannot be confidently split.

Out of scope:

- Nested subtasks or task trees
- Automatically expanding one task into N entity-specific tasks
- Changing the runtime scheduler beyond consuming the resulting flat tasks

## Current Problem

Today the main agent can produce a valid plan, but it still tends to merge multiple actions into one task. For example, it may produce a single task like "调研热门 agent harness 框架，整理结果，并为每个框架生成 Mermaid 架构图后保存到本地" when the preferred plan should be split into smaller steps such as research, shortlist, analyze, diagram, and save.

This makes confirmation less clear for the user and reduces the orchestrator's ability to surface parallelism and recover from partial failure.

## Proposed Approach

### 1. Prompt-level aggressive splitting

Update the main-agent analysis prompt in `src/agents/codex-main-agent.js` so the model explicitly prefers finer flat tasks.

Prompt rules to add:

- Each task should represent one primary action.
- If a sentence contains multiple actions, split it into multiple tasks unless the actions are inseparable.
- Prefer smaller executable tasks over larger combined tasks.
- Keep the result flat; do not create nested subtasks.
- Preserve ordering and dependencies between the smaller tasks.

This keeps the model responsible for the first-pass interpretation and dependency graph.

### 2. Local task-breakdown quality gate

After `normalizeAnalysis()` returns, run a local validator that checks whether the plan still contains suspiciously coarse tasks.

The validator should detect:

- Titles or details containing multiple distinct action verbs
- Combined "do X and Y" style phrasing
- Single tasks that appear to bundle research, analysis, generation, and saving in one step

The validator should stay heuristic and conservative. It does not need perfect linguistic understanding; it only needs to catch clearly coarse breakdowns.

### 3. One retry with stronger instructions

If the first plan fails the quality gate, the main agent should re-run analysis once using the same Codex thread, with an additional instruction that the previous plan was too coarse and must be broken into smaller flat tasks.

This preserves conversational continuity and gives the model a chance to self-correct without involving the user immediately.

### 4. Clarification fallback

If the retry still fails the quality gate, return a clarification result instead of executing a weak plan.

Clarification should tell the user that the request still contains multiple actions that could not be separated confidently, and ask for clearer task boundaries.

This keeps the system from silently executing a coarse or misleading plan.

## Data Flow

The updated `analyzeTodo()` flow will be:

1. Run analysis with the default aggressive-splitting prompt.
2. Normalize the returned JSON into the existing task shape.
3. Check whether the normalized plan passes the local breakdown-quality gate.
4. If it passes, return it.
5. If it fails, run one retry with a stronger "split more aggressively" instruction.
6. Normalize the retry result and check it again.
7. If it passes, return it.
8. If it fails, return `needsClarification: true`.

## Components

### `src/agents/codex-main-agent.js`

Changes:

- Strengthen `buildAnalysisPrompt()`
- Add a second prompt builder or retry-instruction path
- Add a coarse-breakdown detector
- Update `analyzeTodo()` to perform one retry before clarification fallback

Non-changes:

- Keep the same output schema
- Keep the same public `analyzeTodo(input)` interface
- Keep thread reuse behavior

### `src/lib/app.js`

No user-flow redesign is required.

The app should continue to:

- Ask for clarification when `needsClarification` is true
- Show the finer-grained plan during confirmation
- Derive parallel waves from the returned dependencies

## Error Handling

- If Codex returns invalid JSON, keep the existing clarification fallback.
- If the retry path throws because of shutdown/interruption, preserve the current interruption behavior.
- If the quality gate is overly strict, the failure mode should be clarification rather than silent execution.

## Testing

Add or update tests around `CodexMainAgent`:

- Prompt-driven result that already contains fine tasks should pass without retry.
- Coarse first result followed by finer retry result should return the retry result.
- Coarse first result followed by coarse retry result should return clarification.
- Existing shutdown and thread reuse behavior must still pass.

Add a user-facing test in `test/app.test.js`:

- A coarse compound request should result in a finer confirmation plan after main-agent analysis, not a single merged step.

## Tradeoffs

Benefits:

- Better user confirmation UX
- Better dependency visibility and parallel scheduling
- Safer recovery when a middle step fails

Costs:

- One extra model turn in some cases
- Heuristic quality gate may need tuning

Why this is acceptable:

- The retry happens only when the first plan is clearly too coarse.
- For this demo, correctness and inspectability are more important than minimizing one extra planning turn.

## Success Criteria

This design is successful when:

- The main agent defaults to smaller flat tasks for multi-action requests.
- Users see a clearer execution plan during confirmation.
- The orchestrator receives the same flat task shape it already understands.
- Coarse plans are retried or clarified instead of being executed silently.

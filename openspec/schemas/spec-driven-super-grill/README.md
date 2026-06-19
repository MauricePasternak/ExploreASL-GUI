# spec-driven-super-grill

Enhanced OpenSpec workflow combining in-context requirement gathering (grill sessions) with rigorous, subagent-driven implementation. Optimized for speed, test-driven development, and code review rigor.

## Philosophy

- **In-Context Clarification**: Replaces expensive brainstorm artifacts with live chat "grill" sessions.
- **Micro-Tasking**: Breaks down tasks into 2-5 minute steps using `writing-plans`.
- **Subagent Rigor**: Strictly uses `subagent-driven-development` to enforce RED-GREEN-REFACTOR cycles and pre-commit code reviews.
- **Token Efficient**: Drops non-essential artifacts (`verify`, `retrospective`) to save output tokens.

---

## Workflow Guide

### Stage 1: Clarify & Define

Start by defining the requirements interactively in your agent chat. Use the `grill-me` or `grill-with-docs` skills.
Optionally, also invoke the `caveman` skill to reduce output tokens.

```text
> [feature description]. Use "grill-me" to clarify requirements and design.
```

_Discuss until consensus is reached._

### Stage 2: Initialize OpenSpec & Generate Artifacts

Create the feature directory and generate the `proposal`, `specs`, `design`, `tasks`, and `plan` artifacts based on your grill session.

```text
> /opsx:new <feature-name>
> /opsx:ff
```

### Stage 3: Execution & Finalization

Run apply. Schema instructions auto-trigger worktree, subagents, and cleanup.
**CRITICAL:** Clear context (`/clear`) before running apply. Subagents get fresh context, but parent agent needs clean state to save input tokens.

```text
> /clear
> /opsx:apply
```

_(Agent sets up worktree, executes tasks via subagents, then prompts for `/opsx:archive` and branch cleanup)._

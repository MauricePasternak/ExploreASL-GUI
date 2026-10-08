# spec-driven-reviewed-groups

OpenSpec's stock proposal, delta-spec, and design flow with bounded implementation groups and independent read-only review.

## Task Shape

- `## N.` headings define cohesive implementation/review groups.
- Checkboxes are atomic observable actions, not one checkbox or test per scenario.
- Planning names required behavioral boundaries and known coverage; it does not predeclare an exhaustive test list.
- Changed behavior uses RED-GREEN-REFACTOR. Refactors, deletions, and already-covered behavior use baseline-GREEN/change/GREEN.
- Each task requires exact file/symbol, command, test, or observation evidence from the implementer.
- Replacement groups delete superseded code and audit zero callers. Temporary adapters and duplicate authority are forbidden.

## Behavioral Coverage and Retirement

Before test edits, classify affected coverage:

| Existing test or coverage | Surviving product invariant | Action                                    | Requirement     |
| ------------------------- | --------------------------- | ----------------------------------------- | --------------- |
| `<test or category>`      | `<observable behavior>`     | Preserve / Migrate / Delete / Consolidate | `<requirement>` |

Preserve every surviving invariant once. Delete tests only when their behavior is removed. Never preserve old test count, blanket-delete stale-looking suites, reconstruct every old scenario, hide tests, or treat missing dedicated coverage as proof of a gap. Prefer existing and table-driven coverage.

Parent approval is required before test edits when a proposed group adds more than three distinct behavioral cases, adds more than 150 test lines regardless of net deletion, introduces a fixture/helper abstraction, or deletes a complete test file. This is a decision point, not a quality ceiling.

## Apply Gate

Each group MUST receive a fresh implementer session and a fresh independent read-only reviewer session. Neither session may serve another group, even when groups are tightly coupled. The same implementer handles only that group's inventory, implementation, and accepted corrections; the same reviewer handles its bounded re-review. Sealed verification uses a fresh reviewer.

Before dispatch, main verifies session IDs against preceding group evidence. New groups start without a prior session ID. Preserve numbered group IDs and separate session evidence. Only explicit user approval permits a shared integration gate to defer final checks and reviews. Main audits each partial handoff before the next group's fresh dispatch; all affected checkboxes remain unchecked until the complete tree passes mandatory checks and each group receives its own clean review. Shared checks never merge agent ownership or make a partial handoff a PASS.

Implementers and reviewers never edit `tasks.md`. Main leaves every group checkbox unchecked until implementation evidence, mandatory checks, parent triage, and clean review are complete.

Before review, implementer handoff must contain:

1. every task ID mapped to exact file/symbol, command, test, or observation evidence;
2. coverage-retirement mapping and test-budget disposition;
3. owned-file formatting confirmation;
4. passing `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, focused/affected tests, and `pnpm test` results;
5. additional Rust, E2E, or platform checks required by the group.

Repository-wide format writes are reserved for a final integration group. Unrelated failures block or escalate; they never authorize unrelated edits or receive a "pre-existing" waiver.

## Read-Only Review

Reviewer reports only. Any reviewer write is a workflow failure. Blocking findings are limited to direct spec/task violations, supported-scope safety defects, stale-identity mutation, absent equivalent coverage for required behavior, group-caused mechanical failures, false task evidence, or surviving superseded authority.

Optional polish, realism-only fixture changes, duplicate permutations, and speculative edge cases do not block and never trigger correction automatically. A test-gap finding must name the requirement, production trigger, existing tests inspected, why none catch the defect, smallest failing behavior, and preferred existing test to extend.

Main accepts or rejects every finding. Only accepted blockers return to the same implementer, using one observed defect and smallest acceptance condition per correction item. The same reviewer performs one read-only re-review.

If findings remain after that second review, the orchestrator records an evidence-based decision for each: accept, reject, or human-required. It may reject optional findings or authorize one final narrow correction that remains inside approved specs, design, task scope, retirement map, and test budget. Mechanical failures are never waivable.

After a final correction, a fresh read-only reviewer performs sealed verification limited to accepted findings and regressions directly caused by their fixes. It cannot introduce new ordinary findings; only a newly observed catastrophic data-loss, corruption, security, supported-scope resource, or mechanical defect may block. Sealed failure parks the group for the user rather than starting another loop.

Spec/design changes, stronger guarantees, platform/workload support changes, new architecture/dependencies, destructive uncertainty, and unapproved test-budget expansion always require the user. While unavailable, later work may continue only when demonstrably independent of the parked group.

## Interrupted Work

An aborted editing session is an unknown dirty transaction. Main audits status, changed paths, and diff integrity against the pre-dispatch scope before any further delegation. Never infer that abort rolled back writes. A reviewer write receives the same audit and cannot become legitimate merely because later tests pass.

## Evidence

Evidence is a maintained current-state record, not an append-only log. Whenever new evidence is posted, main MUST reconcile affected group records in the same `tasks.md` update: replace superseded proofs/results/verdicts, remove contradictory or stale claims and resolved placeholders, and keep resolved/rejected findings only as concise triage/arbitration dispositions, not active blockers. Check reports against current files, requirements, commands, and review disposition; newer prose alone does not resolve a contradiction. Unverified claims remain pending or blocked.

Writes that invalidate checks, task proofs, or reviews remove their current PASS/completion claims until fresh evidence exists. Reopen every checkbox together if a completed group loses a required gate; update its status. Include affected earlier groups and shared gates, leaving unaffected evidence unchanged. Preserve starting scope, session ownership, and intentional RED/baseline observations as explicitly historical context, never current-tree pass evidence. Reconcile before reviewer dispatch and completion.

Main replaces pending evidence with concise records:

```markdown
### Group N Evidence

- Status: complete
- Starting scope: <baseline and owned paths>
- Implementer: `ses_...`
- Reviewer: `ses_...`
- Method: RED-GREEN-REFACTOR | baseline-GREEN/change/GREEN | verification-only
- Test retirement: <coverage -> invariant -> action -> requirement>
- Test-budget disposition: within budget | approved exception and reason
- Task evidence: N.1 -> <proof>; N.2 -> <proof>; ...
- Verification: owned formatting; exact format-check/lint/typecheck/focused/full commands -> pass
- Review triage: <accepted blockers>; <rejected optional findings>
- Arbitration: not needed | <finding -> accept/reject/human-required with evidence>
- Sealed verification: not needed | `ses_...` -> read-only constrained PASS
- Review: round <N> -> read-only clean PASS; no files changed
```

Only then does main check every microtask in the group together.

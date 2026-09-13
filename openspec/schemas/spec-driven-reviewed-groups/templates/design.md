## Context

<!-- Current state and constraints that shape the approach. See proposal.md for motivation - don't restate it -->

## Goals / Non-Goals

**Goals:**
<!-- What this design aims to achieve -->

**Non-Goals:**
<!-- What is explicitly out of scope -->

## Decisions

<!-- Key design decisions with rationale and alternatives considered -->

## Risks / Trade-offs

<!-- Known risks and trade-offs -->

## Single Authority & Retirement Plan

<!-- Single Authority Invariant: Every capability, lifecycle state, or domain entity MUST have exactly ONE owner.
     Dual pathways, zombie adapters, and half-cutovers are strictly forbidden. -->

### Retirement Matrix

<!-- Map superseded files/symbols to replacements and target deletion groups -->

| Superseded Component / Symbol            | Replacement                          | Deletion Group   | Zero-Caller Verification Method                      |
| :--------------------------------------- | :----------------------------------- | :--------------- | :--------------------------------------------------- |
| <!-- e.g., legacy_process_control.rs --> | <!-- execution-runtime::guardian --> | <!-- Group N --> | <!-- grep -rn "process_control" / compiler check --> |

## Behavioral Test Migration

<!-- Required when replacement work deletes, migrates, or substantially rewrites tests.
     Define surviving product invariants and classify affected coverage as Preserve,
     Migrate, Delete, or Consolidate. Do not preserve old test count or predeclare one
     test per scenario. State any approved test-change budget exception. -->

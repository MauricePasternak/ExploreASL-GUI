# Project Manifest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add a 5th project phase `manifest` that captures per-SubjectSession QC verdicts after Population completes and exports a 4-section methods document (Markdown + HTML).

**Architecture:** New `manifestStore` (Zustand) reads/writes verdicts through `projectStore` into `uiState.manifest` on `.easl`. A new `ManifestPage` renders a Mantine `Stepper` with 2 steps: QC Selection table (mirrors `SubjectSelection` shape) and Manifest Preview + Export. Two new Rust commands probe versions at `startProcessing` time and read `999_ready.status` mtime.

**Tech Stack:** React 19, TypeScript 6, Mantine 9 (Stepper + DataTable + SegmentedControl), Zustand 5, Zod 4, Tauri 2 (plugin-fs, plugin-dialog), Vitest + jsdom.

**Reference docs:** `openspec/changes/project-manifest/proposal.md`, `design.md`, `specs/*/spec.md`. `CONTEXT.md` `## Manifest Module`.

**Conventions:** All snippets below are **pseudocode** — illustrative of shape, not final code. Final implementation may differ. Follow existing file conventions (prettier, eslint, `data-testid` on all components).

**Test command:** `pnpm test` (Vitest + jsdom). Mock Tauri APIs in `src/test/setup.tsx`. After every Rust change: `cargo check` (workdir `src-tauri`). Format: `pnpm format` after frontend edits, `pnpm lint:rust` after Rust edits.

---

## 1. Schema — `.easl` manifest slot

**Files:**

- Modify: `src/schemas/project.ts:6` (`PROJECT_PHASES`), `:45-100` (`ProjectFileSchema.uiState`), `:217-231` (`canAccessPhase`)
- Test: `src/schemas/project.test.ts`

- [x] **1.1 Add failing test — PROJECT_PHASES tuple includes manifest**

`src/schemas/project.test.ts` — pseudocode:

```ts
it("includes manifest in PROJECT_PHASES", () => {
  expect(PROJECT_PHASES).toEqual([
    "import",
    "parameters",
    "processing",
    "visualization",
    "manifest",
  ]);
});
```

- [x] **1.2 Run test — fails**

Run: `pnpm test -- project.test.ts`
Expected: FAIL (no `manifest` in tuple)

- [x] **1.3 Extend PROJECT_PHASES**

`src/schemas/project.ts:6`:

```ts
export const PROJECT_PHASES = [
  "import",
  "parameters",
  "processing",
  "visualization",
  "manifest",
] as const;
```

- [x] **1.4 Add failing test — ProjectFileSchema accepts uiState.manifest**

```ts
it("parses uiState.manifest when present", () => {
  const file = {
    version: "0.1.0",
    projectMeta: {/* minimal valid ProjectMeta */},
    uiState: {
      manifest: {
        verdicts: {
          "sub-A_01": { status: "pass", setAt: 1700000000000 },
          "sub-B_01": {
            status: "fail",
            reason: "motion",
            notes: "run 2 unusable",
            setAt: 1700000000000,
          },
        },
        lastRunVersions: { exploreASL: "1.0.0", matlab: "R2023b", gui: "0.1.0" },
        lastPopulationRunMtime: 1700000000000,
      },
    },
  };
  expect(() => ProjectFileSchema.parse(file)).not.toThrow();
});

it("rejects fail verdict without reason", () => {
  const file = {
    version: "0.1.0",
    projectMeta: {/* minimal */},
    uiState: { manifest: { verdicts: { "sub-X_01": { status: "fail", setAt: 1700000000000 } } } },
  };
  expect(() => ProjectFileSchema.parse(file)).toThrow();
});

it("rejects unknown reason vocabulary", () => {
  const file = {
    version: "0.1.0",
    projectMeta: {/* minimal */},
    uiState: {
      manifest: {
        verdicts: { "sub-X_01": { status: "fail", reason: "shark_attack", setAt: 1700000000000 } },
      },
    },
  };
  expect(() => ProjectFileSchema.parse(file)).toThrow();
});

it("rejects notes longer than 500 chars", () => {
  const file = {
    version: "0.1.0",
    projectMeta: {/* minimal */},
    uiState: {
      manifest: {
        verdicts: {
          "sub-X_01": {
            status: "fail",
            reason: "motion",
            notes: "x".repeat(501),
            setAt: 1700000000000,
          },
        },
      },
    },
  };
  expect(() => ProjectFileSchema.parse(file)).toThrow();
});

it("parses legacy file without uiState.manifest", () => {
  const file = { version: "0.1.0", projectMeta: {/* minimal */} };
  expect(() => ProjectFileSchema.parse(file)).not.toThrow();
});
```

- [x] **1.5 Run tests — fail**

- [x] **1.6 Add ManifestUiStateSchema + slot in ProjectFileSchema**

`src/schemas/project.ts` — pseudocode:

```ts
export const MANIFEST_FAIL_REASONS = [
  "motion",
  "coverage",
  "dropout",
  "artifact",
  "registration",
  "other",
] as const;
export type ManifestFailReason = (typeof MANIFEST_FAIL_REASONS)[number];

export const ManifestVerdictSchema = z
  .object({
    status: z.enum(["pass", "fail"]),
    reason: z.enum(MANIFEST_FAIL_REASONS).optional(),
    notes: z.string().max(500).optional(),
    setAt: z.number().int(),
  })
  .superRefine((v, ctx) => {
    if (v.status === "fail" && !v.reason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "reason required for fail verdict",
        path: ["reason"],
      });
    }
  });
export const ManifestUiStateSchema = z
  .object({
    verdicts: z.record(z.string(), ManifestVerdictSchema).default({}),
    lastRunVersions: z
      .object({
        exploreASL: z.string().optional(),
        matlab: z.string().optional(),
        gui: z.string().optional(),
      })
      .default({}),
    lastPopulationRunMtime: z.number().int().nullable().default(null),
  })
  .optional();
// Add to ProjectFileSchema.uiState: manifest: ManifestUiStateSchema.optional()
```

- [x] **1.7 Run tests — pass**

- [x] **1.8 Add failing test — canAccessPhase("manifest") gate**

```ts
it("grants manifest access when population completed", () => {
  const proj = makeProject({ uiState: { population: { completed: true } } });
  expect(canAccessPhase(proj, "manifest")).toBe(true);
});
it("denies manifest access when population incomplete", () => {
  const proj = makeProject({ uiState: { population: { completed: false } } });
  expect(canAccessPhase(proj, "manifest")).toBe(false);
});
```

- [x] **1.9 Run — fail**

- [x] **1.10 Add manifest branch in canAccessPhase**

`src/schemas/project.ts:228` — pseudocode:

```ts
if (targetPhase === "manifest") {
  return project.uiState?.population?.completed === true;
}
```

- [x] **1.11 Ensure tests pass (`pnpm test`), no typescript errors were generated (`pnpm typecheck`), and no linting errors were generated (`pnpm lint`) then `pnpm format`**

---

## 2. Layout — nav entry, route, redirect guard

**Files:**

- Modify: `src/components/Layout.tsx:39-42` (PHASE_NAV), `:199-216` (nav rendering loop — confirm it accepts the new entry)
- Create: `src/pages/ManifestPage.tsx`
- Modify: `src/App.tsx:58-63` (add route)
- Test: `src/components/Layout.test.tsx`, `src/App.test.tsx` (if exists)

- [x] **2.1 Add failing test — Layout renders Manifest nav button**

Pseudocode: mount Layout with project `population.completed: true`, assert `[data-testid="layout-nav-manifest"]` exists and is not disabled.

- [x] **2.2 Run — fail**

- [x] **2.3 Add PHASE_NAV entry**

`src/components/Layout.tsx`:

```tsx
{ phase: "manifest", label: "Manifest", icon: IconFileReport },
```

(Add to imports: `IconFileReport` from `@tabler/icons-react`. Confirm `PHASE_NAV` typing accepts the new phase; it derives from `ProjectPhase`.)

- [x] **2.4 Add failing test — Manifest route renders ManifestPage**

- [x] **2.5 Add route**

`src/App.tsx`:

```tsx
<Route path="/project/:id/manifest" element={<ManifestPage />} />
```

(Confirm inner `<Route>` list accepts new path — ProjectPage may be a layout route.)

- [x] **2.6 Create minimal ManifestPage**

`src/pages/ManifestPage.tsx` — pseudocode:

```tsx
export default function ManifestPage() {
  return (
    <Stack data-testid="manifest-page">
      <Text>Manifest — under construction</Text>
    </Stack>
  );
}
```

- [x] **2.7 Ensure tests pass (`pnpm test`), no typescript errors were generated (`pnpm typecheck`), and no linting errors were generated (`pnpm lint`) then `pnpm format`**

---

## 3. Help drawer content for manifest phase

**Files:**

- Modify: `src/components/PageHelpButton.tsx` (`HELP_DATA` map)
- Test: `src/components/PageHelpButton.test.tsx`

- [x] **3.1 Add failing test — manifest help drawer contains re-run lockout warning**

Pseudocode: render with `contentKey="manifest"`, assert text "re-running" (or equivalent) appears in help content.

- [x] **3.2 Run — fail**

- [x] **3.3 Add HELP_DATA entry for manifest**

Pseudocode:

```tsx
manifest: {
  title: "Project Manifest",
  subtitle: "Capture QC verdicts and export a methods document",
  goal: "After Population completes, review each SubjectSession as Pass or Fail, then export a journal-ready manifest as Markdown or HTML.",
  steps: [
    "Use the QC Selection table to set a Pass/Fail verdict for each SubjectSession",
    "Neutral rows block progression — resolve all or exclude via No Info",
    "Open Manifest Preview to review the 4 sections (Study Parameters, Software Manifest, QC Summary, Pipeline Summary)",
    "Export Markdown or HTML — both are byte-identical across Windows 11, macOS, and Linux",
  ],
  tipTitle: "Re-run lockout",
  tipContent: "Re-running the Population module locks this phase until the new run completes. Verdicts are retained and marked Stale once the new run finishes; confirm or re-triage them before exporting.",
}
```

- [x] **3.4 Ensure tests pass (`pnpm test`), no typescript errors were generated (`pnpm typecheck`), and no linting errors were generated (`pnpm lint`) then `pnpm format`**

---

## 4. Rust — version capture command

**Files:**

- Create: `src-tauri/src/manifest.rs` with `tauri::command` `capture_environment_versions`
- Modify: `src-tauri/src/lib.rs` (register command in `invoke_handler`)
- Modify: `src-tauri/src/commands.rs` (if it re-exports commands; follow pattern in `visualization.rs`)
- Test: `src-tauri/src/manifest_tests.rs`

- [x] **4.1 Add failing Rust test — capture_environment_versions returns structured object**

Pseudocode:

```rust
#[test]
fn returns_unknown_on_missing_exploreasl_version_file() {
    let result = capture_environment_versions(&temp_dir, &matlab_path);
    assert_eq!(result.explore_asl, "unknown");
}
```

- [x] **4.2 Run — fails to compile**

Run: `cargo check` (workdir `src-tauri`)

- [x] **4.3 Implement capture_environment_versions**

`src-tauri/src/manifest.rs` — pseudocode:

```rust
#[derive(Serialize)]
pub struct EnvironmentVersions { pub explore_asl: String, pub matlab: String }

#[tauri::command]
pub fn capture_environment_versions(
    explore_asl_path: String, matlab_path: String,
) -> EnvironmentVersions {
    let explore_asl = read_version_file(&explore_asl_path).unwrap_or_else(|_| "unknown".into());
    let matlab = probe_matlab_version(&matlab_path).unwrap_or_else(|_| "unknown".into());
    EnvironmentVersions { explore_asl, matlab }
}

fn read_version_file(p: &str) -> Result<String, io::Error> {
    // reads ExploreASL/VERSION or equivalent convention
}
fn probe_matlab_version(p: &str) -> Result<String, io::Error> {
    // shelles out to matlab -batch "version"
}
```

- [x] **4.4 Register in invoke_handler**

`src-tauri/src/lib.rs` — pseudocode:

```rust
.invoke_handler(tauri::generate_handler![
    // existing...
    manifest::capture_environment_versions,
    manifest::read_population_ready_mtime,
])
```

- [x] **4.5 Run `cargo check` + `cargo test` — pass. `pnpm lint:rust`.**

---

## 5. Rust — read 999_ready mtime command

(Same `manifest.rs` file as Task 4 — separate task to keep each ≤2h.)

- [x] **5.1 Add failing test — read_population_ready_mtime returns null when file missing**

- [x] **5.2 Run — fail**

- [x] **5.3 Implement read_population_ready_mtime**

`src-tauri/src/manifest.rs` — pseudocode:

```rust
#[tauri::command]
pub fn read_population_ready_mtime(project_root: String) -> Option<i64> {
    let p = std::path::Path::new(&project_root)
        .join("derivatives/ExploreASL")
        .join("xASL_module_Population/xASL_module_Population/999_ready.status");
    p.metadata().ok().and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
}
```

(Confirm exact population lock path conventions match `processing.rs:490-510`.)

- [x] **5.4 Run tests — pass. `pnpm lint:rust`.**

---

## 6. projectStore — actions for manifest slot

**Files:**

- Modify: `src/stores/projectStore.ts:24-39` (interface), `:198-220` (`setPopulationCompleted` impl)
- Test: `src/stores/projectStore.test.ts`

- [x] **6.1 Add failing test — setManifestVerdict writes verdict slot + marks dirty**

Pseudocode:

```ts
it("setManifestVerdict with pass writes verdict slot", () => {
  const { result } = renderHook(() => useProjectStore());
  act(() => result.current.setManifestVerdict("sub-A_01", "pass", { setAt: 1700000000000 }));
  expect(result.current.project?.uiState.manifest?.verdicts["sub-A_01"]).toEqual({
    status: "pass",
    setAt: 1700000000000,
  });
  expect(result.current.isDirty).toBe(true);
});

it("setManifestVerdict with fail requires reason", () => {
  const { result } = renderHook(() => useProjectStore());
  expect(() =>
    act(() => result.current.setManifestVerdict("sub-B_01", "fail", { setAt: 1 })),
  ).toThrow(/reason required/);
  expect(result.current.project?.uiState.manifest?.verdicts["sub-B_01"]).toBeUndefined();
});

it("setManifestVerdict preserves prior verdict's notes/when toggling pass→fail", () => {
  const { result } = renderHook(() => useProjectStore());
  act(() => result.current.setManifestVerdict("sub-C_01", "pass", { setAt: 1, notes: "looks ok" }));
  act(() => result.current.setManifestVerdict("sub-C_01", "fail", { reason: "motion", setAt: 2 }));
  expect(result.current.project?.uiState.manifest?.verdicts["sub-C_01"]).toEqual({
    status: "fail",
    reason: "motion",
    notes: undefined,
    setAt: 2,
  });
});
```

- [x] **6.2 Run — fail**

- [x] **6.3 Add actions: setManifestVerdict, setLastRunVersions, setLastPopulationRunMtime**

Pseudocode in `projectStore.ts`:

```ts
setManifestVerdict: (subjectSession, status, opts: { reason?; notes?; setAt }) => set((state) => {
  // validate reason-on-fail invariant here (Zod-level check at schema, defensive here too)
  const verdict = ManifestVerdictSchema.parse({ status, reason: opts.reason, notes: opts.notes, setAt: opts.setAt });
  return {
    isDirty: true,
    project: state.project && {
      ...state.project,
      uiState: {
        ...state.project.uiState,
        manifest: {
          verdicts: { ...(state.project.uiState?.manifest?.verdicts ?? {}), [subjectSession]: verdict },
          lastRunVersions: state.project.uiState?.manifest?.lastRunVersions ?? {},
          lastPopulationRunMtime: state.project.uiState?.manifest?.lastPopulationRunMtime ?? null,
        },
      },
    },
  };
}),
// similar for setLastRunVersions, setLastPopulationRunMtime
```

- [x] **6.4 Add failing test — setLastPopulationRunMtime(null) on missing file**

- [x] **6.5 Ensure tests pass (`pnpm test`), no typescript errors were generated (`pnpm typecheck`), and no linting errors were generated (`pnpm lint`) then `pnpm format`**

---

## 7. processingStore — wire version capture + mtime capture

**Files:**

- Modify: `src/stores/processingStore.ts:100-140` (`startProcessing`), `:236-280` (worker completion handler — confirm exact line of `setPopulationCompleted(true)` call)
- Test: `src/stores/processingStore.test.ts`

- [x] **7.1 Add failing test — startProcessing with population calls capture_environment_versions**

Pseudocode: mock `invoke` to return `{ exploreASL: "1.0.0", matlab: "R2023b" }`, call `startProcessing` with `modules: ["population"]`, assert `projectStore.project.uiState.manifest.lastRunVersions` populated.

- [x] **7.2 Run — fail**

- [x] **7.3 Invoke capture_environment_versions at startProcessing time**

`src/stores/processingStore.ts:118` — pseudocode (only when modules includes population):

```ts
if (config.modules.includes("population")) {
  useProjectStore.getState().setPopulationCompleted(false);
  const { invoke } = await import("@tauri-apps/api/core");
  try {
    const versions = await invoke("capture_environment_versions", {
      exploreAslPath: config.exploreAslPath,
      matlabPath: config.matlabPath,
    });
    const gui = import.meta.env.VITE_APP_VERSION ?? "unknown";
    useProjectStore.getState().setLastRunVersions({ ...versions, gui });
  } catch (err) {
    console.warn("[manifest] version capture failed", err);
    useProjectStore.getState().setLastRunVersions({
      exploreASL: "unknown",
      matlab: "unknown",
      gui: "unknown",
    });
  }
}
```

- [x] **7.4 Add failing test — after Population completes, setLastPopulationRunMtime called**

- [x] **7.5 Run — fail**

- [x] **7.6 Invoke read_population_ready_mtime after Population completion**

Find the `setPopulationCompleted(true)` call in `processingStore.ts`. Pseudocode after it:

```ts
if (config.modules.includes("population")) {
  try {
    const mtime = await invoke("read_population_ready_mtime", { projectRoot });
    useProjectStore.getState().setLastPopulationRunMtime(mtime);
  } catch (err) {
    console.warn("[manifest] mtime read failed", err);
    useProjectStore.getState().setLastPopulationRunMtime(null);
  }
}
```

- [x] **7.7 Ensure tests pass (`pnpm test`), no typescript errors were generated (`pnpm typecheck`), and no linting errors were generated (`pnpm lint`) then `pnpm format`**

---

## 8. manifestSchemas — TypeScript shapes for manifest module

**Files:**

- Create: `src/schemas/manifestSchemas.ts`
- Test: `src/schemas/manifestSchemas.test.ts`

- [x] **8.1 Add failing test — ManifestVerdictSchema rejects invalid status**

Pseudocode:

```ts
it("rejects status 'neutral'", () => {
  expect(() => ManifestVerdictSchema.parse({ status: "neutral", setAt: 1 })).toThrow();
});
```

- [x] **8.2 Run — fail**

- [x] **8.3 Create manifestSchemas.ts**

Pseudocode:

```ts
import { ManifestVerdictSchema, MANIFEST_FAIL_REASONS } from "./project";
export type ManifestVerdict = z.infer<typeof ManifestVerdictSchema>;
export type ManifestFailReason = (typeof MANIFEST_FAIL_REASONS)[number];
export const DISPLAY_VERDICTS = ["neutral", "pass", "fail", "no-info", "stale"] as const;
export type DisplayVerdict = (typeof DISPLAY_VERDICTS)[number];
// failReasonLabels used by the QcSelectionTable reason picker dropdown
export const FAIL_REASON_LABELS: Record<ManifestFailReason, string> = {
  motion: "Motion",
  coverage: "Coverage",
  dropout: "Signal Dropout",
  artifact: "Artifact",
  registration: "Registration",
  other: "Other",
};
```

(Do NOT redeclare verdict-shape schemas here — import from `project.ts` to keep single source.)

- [x] **8.4 Ensure tests pass (`pnpm test`), no typescript errors were generated (`pnpm typecheck`), and no linting errors were generated (`pnpm lint`) then `pnpm format`**

## 9. manifestStore — ephemeral UI state for stepper

**Files:**

- Create: `src/stores/manifestStore.ts`
- Test: `src/stores/manifestStore.test.ts`

- [x] **9.1 Add failing test — stays on step 0 by default, nextStep advances**

Pseudocode:

```ts
it("advances step", () => {
  const { result } = renderHook(() => useManifestStore());
  act(() => result.current.setStep(1));
  expect(result.current.step).toBe(1);
});
```

- [x] **9.2 Run — fail**

- [x] **9.3 Create manifestStore.ts**

Pseudocode:

```ts
interface ManifestUiState {
  step: 0 | 1;
  filter: "all" | "neutral" | "pass" | "fail" | "no-info";
  staleVerdicts: Set<string>;
  setStep: (s: 0 | 1) => void;
  setFilter: (f: ManifestUiState["filter"]) => void;
  recomputeStaleVerdicts: (projectRoot: string) => Promise<void>;
  // reads 999_ready mtime via invoke, compares to each verdict's setAt
}
```

- [x] **9.4 Add failing test — staleVerdicts populated when mtimes mismatch**

- [x] **9.5 Implement recomputeStaleVerdicts**

Pseudocode:

```ts
recomputeStaleVerdicts: async (projectRoot) => {
  const { invoke } = await import("@tauri-apps/api/core");
  const current = await invoke<number | null>("read_population_ready_mtime", { projectRoot });
  set((state) => {
    const verdicts = useProjectStore.getState().project?.uiState?.manifest?.verdicts ?? {};
    const stale = new Set<string>();
    for (const [ss, v] of Object.entries(verdicts)) {
      if (current !== null && v.setAt !== current) stale.add(ss);
    }
    return { staleVerdicts: stale };
  });
};
```

- [x] **9.6 Ensure tests pass (`pnpm test`), no typescript errors were generated (`pnpm typecheck`), and no linting errors were generated (`pnpm lint`) then `pnpm format`**

---

## 10. lib/manifestQc — read Population QC outputs + aggregate

**Files:**

- Create: `src/lib/manifestQc.ts`
- Test: `src/lib/manifestQc.test.ts`

- [x] **10.1 Add failing test — readQcOutputs returns null when CSVs missing**

Pseudocode:

```ts
it("returns null when coverage.csv missing", async () => {
  mockFs({}); // empty
  const result = await readSubjectQcOutputs(projectRoot, "sub-X_01");
  expect(result).toBeNull();
});
```

- [x] **10.2 Run — fail**

- [x] **10.3 Implement readSubjectQcOutputs**

Pseudocode: use `@tauri-apps/plugin-fs` exists + readTextFile on `Coverage.tsv`, `SpatialCoV.tsv`, `Motion_*.tsv` paths under `derivatives/ExploreASL/.../population/`. Return `{ coverage, spatialCov, motion, motionExclusionPct }` or null.

- [x] **10.4 Add failing test — aggregateMotionBySubject uses max across runs**

```ts
it("takes max across runs", () => {
  expect(aggregateMotionBySubject([0.4, 0.7, 0.5])).toBe(0.7);
});
```

- [x] **10.5 Implement aggregateMotionBySubject**

Pseudocode:

```ts
export function aggregateMotionBySubject(runMotions: number[]): number {
  return Math.max(...runMotions);
}
```

- [x] **10.6 Add failing test — aggregateGroupStats excludes fail + no-info; returns mean AND sd**

```ts
it("excludes fail rows from coverage mean and SD", () => {
  const rows = [
    { verdict: "pass", coverage: 95 },
    { verdict: "pass", coverage: 90 },
    { verdict: "fail", coverage: 50 },
    { verdict: "no-info", coverage: undefined },
  ];
  const result = aggregateMeanSd(rows, (r) => r.coverage);
  expect(result.mean).toBeCloseTo(92.5, 2);
  expect(result.sd).toBeCloseTo(3.54, 2); // population SD of [95, 90]
});

it("returns null SD for single-subject group", () => {
  const rows = [{ verdict: "pass", coverage: 88 }];
  expect(aggregateMeanSd(rows, (r) => r.coverage).sd).toBeNull();
});

it("returns null mean and SD when zero pass rows", () => {
  const rows = [{ verdict: "fail", coverage: 80 }];
  expect(aggregateMeanSd(rows, (r) => r.coverage)).toEqual({ mean: null, sd: null });
});
```

- [x] **10.7 Implement aggregateMeanSd + aggregateGroupStats**

Pseudocode:

```ts
export function aggregateMeanSd<T>(
  rows: T[],
  val: (r: T) => number | undefined,
): { mean: number | null; sd: number | null } {
  const vals = rows
    .filter((r) => r.verdict === "pass")
    .map(val)
    .filter((v): v is number => v !== undefined);
  if (vals.length === 0) return { mean: null, sd: null };
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  if (vals.length < 2) return { mean, sd: null };
  const variance = vals.reduce((acc, v) => acc + (v - mean) ** 2, 0) / vals.length; // population SD
  return { mean, sd: Math.sqrt(variance) };
}
export function formatMeanSd(stats: { mean: number | null; sd: number | null }): string {
  if (stats.mean === null) return "N/A";
  if (stats.sd === null) return `${stats.mean.toFixed(2)} (N/A)`;
  return `${stats.mean.toFixed(2)} (${stats.sd.toFixed(2)})`;
}
```

- [x] **10.8 Add failing test — aggregateFailReasons returns count per reason**

```ts
it("counts fail verdicts by reason", () => {
  const rows = [
    { verdict: "fail", reason: "motion" },
    { verdict: "fail", reason: "motion" },
    { verdict: "fail", reason: "coverage" },
    { verdict: "fail", reason: undefined }, // shouldn't happen (schema blocks), defensive: skipped
    { verdict: "pass" },
  ];
  expect(aggregateFailReasons(rows)).toEqual({ motion: 2, coverage: 1 });
});
```

- [x] **10.9 Implement aggregateFailReasons**

Pseudocode:

```ts
export function aggregateFailReasons<T extends { verdict: string; reason?: string }>(
  rows: T[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of rows) {
    if (r.verdict === "fail" && r.reason) counts[r.reason] = (counts[r.reason] ?? 0) + 1;
  }
  return counts;
}
```

- [x] **10.10 Ensure tests pass (`pnpm test`), no typescript errors were generated (`pnpm typecheck`), and no linting errors were generated (`pnpm lint`) then `pnpm format`**

---

## 11. lib/manifestExport — Markdown + HTML generators

**Files:**

- Create: `src/lib/manifestExport.ts`
- Create: `src/lib/manifestExport.test.ts` with golden-file fixtures `src/lib/__fixtures__/manifest.golden.md`, `manifest.golden.html`
- Reference: `notes/Manifest_Pipeline_Summary.md` for Section 4 paragraph

- [x] **11.1 Add failing test — renderMarkdown matches golden file**

```ts
it("renders markdown byte-identical to golden", () => {
  const manifest = makeFixtureManifest(); // helper
  const out = renderMarkdown(manifest);
  expect(out).toEqual(readGolden("manifest.golden.md"));
});
```

- [x] **11.2 Run — fail (no renderMarkdown, no golden)

- [x] **11.3 Create golden fixture from known input**

Write `__fixtures__/manifest.golden.md` with the expected Markdown for `makeFixtureManifest()`. (Author the fixture by hand first, then derive code to match.)

- [x] **11.4 Implement renderMarkdown**

Pseudocode:

```ts
export function renderMarkdown(m: ManifestPayload): string {
  return [
    "# Project Manifest",
    "## Section 1: Study Parameters",
    ...m.metadataGroups.map(renderGroupTable),
    "## Section 2: Software Manifest",
    `- ExploreASL Version: ${m.versions.exploreASL ?? "unknown"}`,
    // ...
    "## Section 3: QC Summary",
    ...m.metadataGroups.map(renderQcTable),
    "## Section 4: Pipeline Summary",
    m.pipelineParagraph,
  ].join("\n");
}
```

- [x] **11.5 Run — test passes.**

- [x] **11.6 Add failing test — renderHtml matches golden**

- [x] **11.7 Create golden fixture `__fixtures__/manifest.golden.html`**

- [x] **11.8 Implement renderHtml (inline CSS, single file)**

Pseudocode:

```ts
export function renderHtml(m: ManifestPayload): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${INLINE_CSS}</style></head><body>${markdownToHtml(renderMarkdown(m))}</body></html>`;
}
```

(Inline-CSS wrapper; no external links; pure templating — no WebView rendering.)

- [x] **11.9 Add failing test — same payload → identical bytes on Win/macOS/Linux**

(Simulated by deterministic templating: no `Date.now()`, no platform-conditional code paths. Test asserts output has no `new Date`/timezone artifacts by snapshotting twice in same run.)

- [x] **11.10 Run all tests. `pnpm format`. Commit.**

```bash
git commit -m "feat(manifest): add byte-identical Markdown and HTML exporters with golden fixtures"
```

---

## 12. QcSelectionTable component — Step 1

**Files:**

- Create: `src/components/manifest/QcSelectionTable.tsx`
- Create: `src/components/manifest/QcSelectionTable.test.tsx`
- Reference: `src/components/processing/SubjectSelection.tsx` for row shape, `MetadataGrouping` for label resolution

- [x] **12.1 Add failing test — renders one row per SubjectSession with verdict SegmentedControl**

Pseudocode: render with 3 SubjectSessions, assert 3 rows + 3 `[data-testid^="verdict-control-"]`.

- [x] **12.2 Run — fail**

- [x] **12.3 Implement QcSelectionTable**

Pseudocode:

```tsx
function QcSelectionTable() {
  const rows = useMergedRows(); // SubjectInfo × MetadataGroup × storedVerdict
  return <DataTable
    records={rows}
    columns={[
      { accessor: "subject", ... },
      { accessor: "session", ... },
      { accessor: "metadataGroup", render: r => r.groupLabel ?? "Ungrouped" },
      { accessor: "structuralStatus", render: r => <StatusIcon .../> },
      { accessor: "aslStatus", render: r => <StatusIcon .../> },
      { accessor: "verdict", render: r => r.noInfo ? <Badge>No Info</Badge> :
        <Group gap="xs">
          <SegmentedControl data-testid={`verdict-control-${r.subjectSession}`}
            data={[{value:"neutral",label:"Neutral"},{value:"pass",label:"Pass"},{value:"fail",label:"Fail"}]}
            value={r.displayedVerdict}
            onChange={v => handleVerdictChange(r.subjectSession, v)} // on fail, opens inline reason picker (12.x)
          />
          {r.displayedVerdict === "fail" && (
            <Select data-testid={`verdict-reason-${r.subjectSession}`}
              data={Object.entries(FAIL_REASON_LABELS).map(([v, label]) => ({ value: v, label }))}
              value={r.reason}
              onChange={(val) => setVerdict(r.subjectSession, "fail", { reason: val })}
              placeholder="Reason"
            />
          )}
          {r.displayedVerdict === "fail" || r.displayedVerdict === "pass" ? (
            <TextInput data-testid={`verdict-notes-${r.subjectSession}`}
              placeholder="Notes (optional)"
              defaultValue={r.notes ?? ""}
              onBlur={(e) => setVerdict(r.subjectSession, r.status, { notes: e.target.value })}
              maxLength={500}
            />
          ) : null}
          {staleVerdicts.has(r.subjectSession) && <Badge color="orange">Stale</Badge>}
        </Group>
      }
      ,
    ]}
  />;
}
// handleVerdictChange invariant: if v === "fail", and no reason already stored, setReason is required BEFORE the
// verdict is persisted — show a temporary inline validation state if user clicks away with no reason.
```

- [x] **12.4 Add failing test — No Info disables SegmentedControl / hides it**

- [x] **12.5 Implement No Info derived status**

Pseudocode: when `readSubjectQcOutputs` returns null, render `<Badge>No Info</Badge>` instead of SegmentedControl.

- [x] **12.5a Add failing test — Fail row renders reason Select + notes TextInput; missing reason shows validation error**

Pseudocode: render table with verdict "fail" but no `reason`; assert `[data-testid^="verdict-reason-"]` exists, has `aria-invalid`, and `data-testid="verdict-reason-error"` visible.

- [x] **12.5b Implement reason Select + notes TextInput inline next to Fail SegmentedControl**

(See 12.3 pseudocode — `Select` + `TextInput` rendered only for verdicts "fail"/"pass". On `fail`, reason Select is required; on save without reason, mark `aria-invalid` and show error text.)

- [x] **12.5c Add failing test — toggling from Pass to Fail clears notes by default**

Pseudocode: render verdict pass with notes, toggle to fail, assert TextInput empty (preserves only via explicit edit per spec scenario "preserves prior verdict's notes when toggling pass→fail" — **re-read spec**: that scenario says `notes: "manual review"` was set explicitly during the pass verdict, and after toggling to fail the verdict carries `notes: undefined` plus new reason. So toggling verdict _status_ does NOT preserve notes; reason becomes required; notes default undefined.)

Confirm spec interpretation before implementing — current spec scenario describes pass-with-notes toggled to fail-without-notes. If user wants notes preservation across status flips, update the spec.

- [x] **12.5d Implement notes handling per spec scenario**

(In spec scenario "Pass verdict with reason is preserved" → toggling pass→fail sets `notes: undefined`.)

- [x] **12.6 Add failing test — Stale pill renders when verdict.setAt ≠ current mtime**

- [x] **12.7 Render Stale pill adjacent to SegmentedControl**

Pseudocode: `if (staleVerdicts.has(r.subjectSession)) <Badge color="orange">Stale</Badge>`.

- [x] **12.8 Add failing test — next button disabled when visible Neutral rows exist**

- [x] **12.9 Wire Next button gate**

Pseudocode: `disabled={visibleRows.some(r => r.displayedVerdict === "neutral")}`.

- [x] **12.10 Add failing test — filter chips show counts and default to neutral**

- [x] **12.11 Implement filter SegmentedControl + counts**

Pseudocode: filter state from `manifestStore`; counts computed via `useMemo` over rows.

- [x] **12.12 Add failing test — Mark all complete→Pass skips No Info**

- [x] **12.13 Implement bulk action**

Pseudocode:

```tsx
onClick={() => {
  rows.filter(r => r.structuralStatus === "complete" && r.aslStatus === "complete" && !r.noInfo)
      .forEach(r => setVerdict(r.subjectSession, "pass"));
}}
```

- [x] **12.14 Ensure tests pass (`pnpm test`), no typescript errors were generated (`pnpm typecheck`), and no linting errors were generated (`pnpm lint`) then `pnpm format`**

---

## 13. ManifestPreview component — Step 2

**Files:**

- Create: `src/components/manifest/ManifestPreview.tsx`
- Test: `src/components/manifest/ManifestPreview.test.tsx`
- Reference: `specs/manifest-preview-export/spec.md` for the 4 sections' content contract

- [x] **13.1 Add failing test — renders 4 sections**

Pseudocode: render preview with fixture payload, assert `[data-testid="manifest-section-study-parameters"]`, `"section-software-manifest"`, `"section-qc-summary"`, `"section-pipeline-summary"` all present.

- [x] **13.2 Run — fail**

- [x] **13.3 Implement ManifestPreview**

Pseudocode:

```tsx
function ManifestPreview() {
  const payload = useBuildManifestPayload(); // reads projectStore + manifestQc
  return (
    <Stack data-testid="manifest-preview">
      <Box data-testid="manifest-section-study-parameters">{renderSection1(payload)}</Box>
      <Box data-testid="manifest-section-software-manifest">{renderSection2(payload)}</Box>
      <Box data-testid="manifest-section-qc-summary">{renderSection3(payload)}</Box>
      <Box data-testid="manifest-section-pipeline-summary">
        <Text>{payload.pipelineParagraph}</Text>
      </Box>
    </Stack>
  );
}
```

- [x] **13.4 Add failing test — conditional rows: PCASL shows Labeling Duration, PASL omits**

- [x] **13.5 Implement renderSection1 conditional rows**

Pseudocode: include `LabelingDuration` row iff `ArterialSpinLabelingType !== "PASL"`; include `BolusCutOffDelayTime` row iff `BolusCutOffFlag === true`.

- [x] **13.6 Add failing test — Pass/Total cell excludes No Info from denominator**

Pseudocode: group with 7 pass, 2 fail, 1 no-info → `7 / 9` (No Info excluded from numerator and denominator per spec).

- [x] **13.6a Add failing test — coverage/CoV/motion cells render "mean (SD)" format**

Pseudocode: group with 2 pass rows coverage 95%, 90% → cell renders `"92.50 (3.54)"`.

- [x] **13.6b Add failing test — SD renders "(N/A)" for single-subject group**

Pseudocode: group with 1 pass row coverage 88% → cell renders `"88.00 (N/A)"`.

- [x] **13.6c Add failing test — Section 3 includes a Fail Reasons breakdown row per group**

Pseudocode: group with 3 fail verdicts (2 motion, 1 coverage) → Section 3 table for that group includes a "Fail Reasons" row rendering `"motion: 2, coverage: 1"` (or equivalent serialized format).

- [x] **13.7 Implement renderSection3 aggregators + Pass/Total cell**

Use `aggregateMeanSd` from `manifestQc.ts` for coverage/CoV/motion cells; `formatMeanSd` formats as `"<mean> (<sd>)"` with `(N/A)` fallback for sd=null. Pass/Total cell: `${passCount} / ${passCount + failCount}`. Add a "Fail Reasons" row per group using `aggregateFailReasons`.

- [x] **13.8 Add failing test — unknown versions render "unknown"**

- [x] **13.9 Implement renderSection2 with `?? "unknown"` fallbacks**

- [x] **13.10 Add failing test — live preview updates after verdict toggle (re-mount)**

Pseudocode: render `<ManifestPreview/>` with state A, change a verdict in projectStore, re-render — assert Pass/Total updated.

- [x] **13.11 Verify live update via Zustand subscription**

No extra code needed if `useBuildManifestPayload` subscribes to `projectStore.uiState.manifest.verdicts` via standard selector — re-render automatic.

- [x] **13.12 Ensure tests pass (`pnpm test`), no typescript errors were generated (`pnpm typecheck`), and no linting errors were generated (`pnpm lint`) then `pnpm format`**

---

## 14. Export buttons — Markdown + HTML

**Files:**

- Modify: `src/components/manifest/ManifestPreview.tsx` (add export buttons at top)
- Test: existing `ManifestPreview.test.tsx`

- [x] **14.1 Add failing test — clicking Export Markdown invokes save + writeTextFile**

Pseudocode: mock `@tauri-apps/plugin-dialog` save to return path, mock `@tauri-apps/plugin-fs` writeTextFile; click Export; assert writeTextFile called with `renderMarkdown(payload)`.

- [x] **14.2 Implement Export Markdown button**

Pseudocode:

```tsx
<Button
  onClick={async () => {
    const path = await save({
      defaultPath: "manifest.md",
      filters: [{ name: "Markdown", extensions: ["md"] }],
    });
    if (!path) return;
    await writeTextFile(path, renderMarkdown(payload));
  }}
>
  Export Markdown
</Button>
```

- [x] **14.3 Add failing test — clicking Export HTML invokes save + writeTextFile with inline-CSS output**

- [x] **14.4 Implement Export HTML button**

Same shape, `renderHtml(payload)`, `filters: [{ name: "HTML", extensions: ["html"] }]`.

- [x] **14.5 Add failing test — both export buttons disabled when no verdicts exist**

Pseudocode: empty `uiState.manifest.verdicts` → buttons disabled.

- [x] **14.6 Implement disabled state**

`disabled={Object.keys(verdicts ?? {}).length === 0}` on both buttons.

- [x] **14.7 Ensure tests pass (`pnpm test`), no typescript errors were generated (`pnpm typecheck`), and no linting errors were generated (`pnpm lint`) then `pnpm format`**

---

## 15. Stepper wrapper — ManifestPage

**Files:**

- Modify: `src/pages/ManifestPage.tsx` (replace minimal stub from Task 2)
- Test: `src/pages/ManifestPage.test.tsx`

- [x] **15.1 Add failing test — renders Mantine Stepper with 2 steps, defaults to step 0**

Pseudocode: assert `[data-testid="manifest-stepper"]` exists, `mantine-Stepper-stepActive` appears on step 0.

- [x] **15.2 Run — fail**

- [x] **15.3 Wire Mantine Stepper**

`src/pages/ManifestPage.tsx` — pseudocode:

```tsx
export default function ManifestPage() {
  const step = useManifestStore((s) => s.step);
  const setStep = useManifestStore((s) => s.setStep);
  return (
    <Stack data-testid="manifest-page">
      <Stepper active={step} onStepClick={setStep} data-testid="manifest-stepper">
        <Stepper.Step label="QC Selection">
          <QcSelectionTable />
        </Stepper.Step>
        <Stepper.Step label="Preview & Export">
          <ManifestPreview />
        </Stepper.Step>
      </Stepper>
    </Stack>
  );
}
```

- [x] **15.4 Add failing test — Next button in step 0 advances to step 1 only when gate passes**

(Mock the gate from QcSelectionTable's exposed handler — use the actual QcSelectionTable Next button.)

- [x] **15.5 Ensure tests pass (`pnpm test`), no typescript errors were generated (`pnpm typecheck`), and no linting errors were generated (`pnpm lint`) then `pnpm format`**

---

## 16. Spec reconciliation + integration smoke

- [x] **16.1 Verify spec — Pass/Total denominator excludes No Info**

Confirm `specs/manifest-preview-export/spec.md` Scenario "Pass / Total with mixed verdicts" reads `"7 / 9"` (10 SubjectSessions = 7 Pass + 2 Fail + 1 No Info; No Info excluded from both). Task 13.6/13.7 implement accordingly.

- [x] **16.2 Run full test suite**

Run: `pnpm test`
Expected: all green (modulo AGENTS.md teardown race noise).

- [x] **16.3 Run lint + typecheck**

Run: `pnpm format && pnpm lint && pnpm lint:rust`
Expected: no errors.

- [x] **16.4 Manual smoke — `pnpm dev` → navigate to manifest phase**

(Tauri APIs unavailable in dev per AGENTS.md; limit to visual rendering of the page with mocked stores via `window.__DEBUG__.stores`.)

- [x] **16.5 Ensure tests pass (`pnpm test`), no typescript errors were generated (`pnpm typecheck`), and no linting errors were generated (`pnpm lint`) then `pnpm format`**

---

## Spec coverage map

| Spec requirement                                                              | Task(s)                                                                                                        |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `manifest-phase`: PROJECT_PHASES extension                                    | 1.1-1.3                                                                                                        |
| `manifest-phase`: canAccessPhase gate                                         | 1.8-1.10                                                                                                       |
| `manifest-phase`: nav entry + route                                           | 2.1-2.6                                                                                                        |
| `manifest-phase`: help drawer + re-run lockout warning                        | 3.1-3.3                                                                                                        |
| `manifest-verdicts`: schema slot (incl. reason + notes)                       | 1.4-1.6, 6.1-6.3                                                                                               |
| `manifest-verdicts`: SubjectSession unit                                      | 9.3 (setVerdict signature)                                                                                     |
| `manifest-verdicts`: verdict reason field (controlled vocab + freeform notes) | 1.4-1.6 (schema), 6.1-6.3 (store), 8.3 (labels), 12.3 + 12.5a-12.5d (UI), 10.8-10.9 + 13.6c-13.7 (aggregation) |
| `manifest-verdicts`: staleness reference                                      | 9.4-9.5                                                                                                        |
| `manifest-verdicts`: persistence to .easl                                     | 6.1-6.3                                                                                                        |
| `manifest-verdicts`: re-run lockout                                           | 7.3 (uses existing setPopulationCompleted(false))                                                              |
| `manifest-qc-selection`: table shape                                          | 12.1-12.3                                                                                                      |
| `manifest-qc-selection`: No Info derived                                      | 12.4-12.5                                                                                                      |
| `manifest-qc-selection`: filter chips + counts                                | 12.10-12.11                                                                                                    |
| `manifest-qc-selection`: Neutral gate                                         | 12.8-12.9                                                                                                      |
| `manifest-qc-selection`: bulk action                                          | 12.12-12.13                                                                                                    |
| `manifest-qc-selection`: stale pill                                           | 12.6-12.7                                                                                                      |
| `manifest-preview-export`: Section 1                                          | 13.4-13.5                                                                                                      |
| `manifest-preview-export`: Section 2                                          | 13.8-13.9                                                                                                      |
| `manifest-preview-export`: Section 3 aggregations (mean+SD, fail reasons)     | 10.6-10.10, 13.6-13.7, 13.6a-13.6c                                                                             |
| `manifest-preview-export`: Section 4 static paragraph                         | 11.3-11.4                                                                                                      |
| `manifest-preview-export`: live preview                                       | 13.10-13.11                                                                                                    |
| `manifest-preview-export`: Markdown + HTML export                             | 14.1-14.6                                                                                                      |
| `manifest-preview-export`: byte-identical across OS                           | 11.9                                                                                                           |
| `manifest-preview-export`: export disabled when no verdicts                   | 14.5-14.6                                                                                                      |
| `manifest-version-capture`: startProcessing hook                              | 7.1-7.3                                                                                                        |
| `manifest-version-capture`: mtime capture                                     | 7.4-7.6                                                                                                        |
| `manifest-version-capture`: overwrite prior values                            | 7.3 overwrites (covered by test asserting `1.0.0` → `1.1.0`)                                                   |
| `project-store`: modified ProjectFileSchema                                   | 1.4-1.6                                                                                                        |
| `processing-store`: startProcessing hook                                      | 7.1-7.6                                                                                                        |
| `app-layout`: Manifest nav entry                                              | 2.1-2.3                                                                                                        |

No spec requirements uncovered.

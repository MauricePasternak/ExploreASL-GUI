# inter-rater-agreement Specification

## Purpose

Defines initial inter-rater agreement computation and display for multi-reviewer manifest workflows. Initial agreement is measured before resolution and quantified using Cohen's Kappa (2 reviewers) or Fleiss' Kappa (>2 reviewers) on categorical pass/fail verdict data. Results are displayed in the manifest Preview & Export step.

## ADDED Requirements

### Requirement: Cohen's Kappa Computation For Two Reviewers

When exactly 2 reviewers exist, the manifest store SHALL compute Cohen's Kappa (κ) on the pass/fail verdicts. The computation SHALL:

1. Construct a 2×2 contingency table from both reviewers' verdicts across all subjectSessions where both reviewers have a non-Neutral verdict.
2. Compute observed agreement (pₒ) as the proportion of subjectSessions where both reviewers agree on status.
3. Compute expected agreement (pₑ) as the sum of products of marginal proportions for each category (pass, fail).
4. Compute κ = (pₒ - pₑ) / (1 - pₑ) when the denominator is nonzero. When all included ratings use only one category, `pₑ = 1` and κ and its CI SHALL be `null` (agreement rate remains 1.0); this degenerate case is not assigned κ = 1.
5. For defined κ, compute the 95% confidence interval using the standard error formula: SE = √(pₒ(1 - pₒ) / (n(1 - pₑ)²)), with CI bounds κ ± 1.96 × SE. The normal-approximation bounds SHALL NOT be clamped to `[-1, 1]`; small samples MAY therefore produce bounds outside the theoretical Kappa range. Identical ratings that use both categories SHALL return κ = 1.0 and CI `[1.0, 1.0]`.

The function signature SHALL be:

```typescript
function cohensKappa(
  verdicts1: Record<string, "pass" | "fail">,
  verdicts2: Record<string, "pass" | "fail">,
): {
  kappa: number | null;
  ci95Lower: number | null;
  ci95Upper: number | null;
  n: number;
  agreementRate: number;
};
```

#### Scenario: Identical ratings with category variation yield κ = 1.0

- **WHEN** Reviewer A and Reviewer B have identical verdicts for all 50 subjectSessions and the set includes both Pass and Fail
- **THEN** `cohensKappa` SHALL return `{ kappa: 1.0, ci95Lower: 1.0, ci95Upper: 1.0, n: 50, agreementRate: 1.0 }`

#### Scenario: Opposing all-pass and all-fail reviewers yield κ = 0

- **WHEN** Reviewer A marks all 10 subjectSessions as Pass and Reviewer B marks all 10 as Fail
- **THEN** `cohensKappa` SHALL return `kappa: 0`, `n: 10`, and `agreementRate: 0.0`

#### Scenario: All ratings in one category yield null κ

- **WHEN** both reviewers mark all included subjectSessions Pass (or both mark all Fail)
- **THEN** `cohensKappa` SHALL return `kappa: null`, `ci95Lower: null`, `ci95Upper: null`, and `agreementRate: 1.0`

#### Scenario: Fewer than two complete ratings yield null κ

- **WHEN** fewer than 2 subjectSessions have verdicts from both reviewers
- **THEN** `cohensKappa` SHALL return `kappa: null`, `ci95Lower: null`, and `ci95Upper: null`

#### Scenario: Partial agreement computes correctly

- **WHEN** Reviewer A has verdicts `[pass, pass, fail, fail, pass]` and Reviewer B has `[pass, fail, fail, fail, pass]` for 5 subjectSessions
- **THEN** `cohensKappa` SHALL return `n: 5`, `agreementRate: 0.8` (4/5 agree), and a `kappa` value between -1 and 1 reflecting chance-corrected agreement

#### Scenario: Category imbalance yields zero Kappa despite raw agreement

- **WHEN** Reviewer A marks all 6 subjectSessions Pass and Reviewer B marks 4 Pass and 2 Fail
- **THEN** initial agreement SHALL be `67% (4/6)`, expected agreement SHALL equal observed agreement, Kappa SHALL be `0.00`, and the unclamped 95% confidence interval SHALL round to `[-1.13, 1.13]`

#### Scenario: Only matching subjectSessions included

- **WHEN** Reviewer A has verdicts for `["sub-01", "sub-02", "sub-03"]` and Reviewer B has verdicts for `["sub-01", "sub-02", "sub-04"]`
- **THEN** `cohensKappa` SHALL compute over the intersection `["sub-01", "sub-02"]` with `n: 2`

### Requirement: Fleiss' Kappa Computation For More Than Two Reviewers

When more than 2 reviewers exist, the manifest store SHALL compute Fleiss' Kappa (κ) on the pass/fail verdicts. The computation SHALL:

1. For each subjectSession, count the number of reviewers assigning `"pass"` and `"fail"`.
2. Compute the proportion of agreeing pairs per subjectSession: Pᵢ = (1 / (k(k-1))) × Σⱼ(nᵢⱼ(nᵢⱼ - 1)), where k is the number of reviewers and nᵢⱼ is the count for category j.
3. Compute P̄ (mean Pᵢ across subjects), P̄ₑ (sum of squared category proportions), and κ = (P̄ - P̄ₑ) / (1 - P̄ₑ).
4. Compute 95% confidence interval using the large-sample variance formula for Fleiss' κ when κ is defined. For fewer than 2 complete subjectSessions or when all included ratings use one category, return null κ and null CI. Identical complete ratings that use both categories yield κ = 1 and CI `[1,1]`.

The function signature SHALL be:

```typescript
function fleissKappa(verdictsByReviewer: Record<string, Record<string, "pass" | "fail">>): {
  kappa: number | null;
  ci95Lower: number | null;
  ci95Upper: number | null;
  n: number;
  agreementRate: number;
};
```

Only subjectSessions where ALL reviewers have a verdict SHALL be included in the computation.

#### Scenario: Three reviewers with identical category-varying ratings

- **WHEN** 3 reviewers all have identical verdicts for 30 subjectSessions and the set includes both Pass and Fail
- **THEN** `fleissKappa` SHALL return `{ kappa: 1.0, ci95Lower: 1.0, ci95Upper: 1.0, n: 30, agreementRate: 1.0 }`

#### Scenario: Single-category Fleiss ratings yield null κ

- **WHEN** every included reviewer rating is Pass (or every rating is Fail)
- **THEN** `fleissKappa` SHALL return `kappa: null`, `ci95Lower: null`, `ci95Upper: null`, and `agreementRate: 1.0`

#### Scenario: Three reviewers with partial disagreement

- **WHEN** 3 reviewers rate 20 subjectSessions and 5 subjectSessions have split verdicts (2 pass, 1 fail)
- **THEN** `fleissKappa` SHALL return `n: 20`, `agreementRate: 0.75` (15/20 unanimous), and a `kappa` value reflecting chance-corrected multi-rater agreement

#### Scenario: SubjectSessions with missing reviewers excluded

- **WHEN** 3 reviewers exist but Reviewer C has only rated 15 of 20 subjectSessions
- **THEN** `fleissKappa` SHALL compute over the 15 subjectSessions where all 3 reviewers have verdicts, with `n: 15`

### Requirement: Initial Agreement Rate Computation

The manifest store SHALL compute an overall initial agreement rate as the proportion of subjectSessions where ALL reviewers agree on `status` (pass vs fail) before resolution. The initial agreement rate SHALL be a simple ratio: `agreementsCount / totalSubjectSessions`, expressed as a number between 0 and 1. The internal result property SHALL remain `agreementRate`.

#### Scenario: Initial agreement rate with mixed verdicts

- **WHEN** 50 subjectSessions exist and 43 have unanimous agreement across all reviewers
- **THEN** the initial agreement rate SHALL be `0.86` (43/50)

#### Scenario: Initial agreement rate with all unanimous

- **WHEN** all subjectSessions have unanimous agreement
- **THEN** the initial agreement rate SHALL be `1.0`

### Requirement: Per-Group Agreement Computation

The manifest store SHALL compute agreement statistics (Kappa and initial agreement rate) per `MetadataGroup`. For each group, the computation SHALL use only the subjectSessions assigned to that group. Groups with fewer than 2 subjectSessions rated by all reviewers SHALL report `kappa: null` (insufficient data) with initial agreement rate still computed.

#### Scenario: Per-group Kappa computed independently

- **WHEN** Group A has 30 subjectSessions and Group B has 20 subjectSessions, each with different agreement patterns
- **THEN** the per-group agreement results SHALL contain separate `kappa`, `agreementRate`, and `n` values for Group A and Group B, computed independently

#### Scenario: Small group reports null Kappa

- **WHEN** a MetadataGroup contains only 1 subjectSession rated by all reviewers
- **THEN** the per-group result for that group SHALL have `kappa: null` and `agreementRate` computed normally (either 0 or 1)

#### Scenario: Ungrouped subjects computed separately

- **WHEN** subjectSessions exist that are not assigned to any MetadataGroup
- **THEN** per-group agreement SHALL include an "Ungrouped" entry with agreement statistics computed across the ungrouped subjectSessions

### Requirement: Agreement Results Shape

The agreement computation SHALL return results conforming to the following TypeScript shape:

```typescript
interface AgreementResults {
  overall: {
    kappa: number | null;
    ci95Lower: number | null;
    ci95Upper: number | null;
    n: number;
    agreementRate: number;
  };
  perGroup: Record<
    string,
    {
      kappa: number | null;
      ci95Lower: number | null;
      ci95Upper: number | null;
      n: number;
      agreementRate: number;
    }
  >;
}
```

The `overall` field SHALL contain statistics computed across ALL subjectSessions. The `perGroup` field SHALL be keyed by `MetadataGroup.label` (or `"Ungrouped"` for unassigned subjects).

#### Scenario: Results shape populated correctly

- **WHEN** agreement is computed with 2 reviewers, 50 total subjectSessions across 2 groups
- **THEN** the returned object SHALL have an `overall` field with nullable `kappa`, `ci95Lower`, and `ci95Upper`, `n: 50`, and `agreementRate`, plus a `perGroup` field with entries for each group label

#### Scenario: Results shape with null per-group Kappa

- **WHEN** a group has only 1 rated subjectSession
- **THEN** the `perGroup` entry for that group SHALL have `kappa: null`, `ci95Lower: null`, `ci95Upper: null`, `n: 1`, and a numeric `agreementRate`

### Requirement: Agreement Display In Manifest Preview

When in multi-reviewer mode, the manifest Preview step SHALL display an "Inter-Rater Agreement" accordion panel between QC Summary and Pipeline Summary. The section SHALL render:

1. **Overall statistics table** with rows: Number of Reviewers, Overall Initial Agreement Rate (as percentage), Kappa (κ) with 95% CI in bracket notation (e.g., `"0.82 [0.71, 0.90]"`), Number of Subjects (n), Subjects Requiring Resolution (count of disagreements).
2. **Per-group statistics table** with one row per MetadataGroup, each showing: Group Label, n, Initial Agreement Rate (%), Kappa with CI (or "N/A" if `kappa` is `null`).
3. **Kappa guidance** beneath the summary: `Initial agreement is unadjusted. Kappa adjusts for agreement expected from each reviewer's pass/fail frequencies; interpret kappa and its confidence interval cautiously with small subject counts.` The same guidance SHALL appear in Markdown and HTML exports, but not CSV output.

The section SHALL NOT be rendered in single-reviewer mode.

#### Scenario: Agreement section rendered in multi-reviewer mode

- **WHEN** the Preview step is loaded in multi-reviewer mode with computed agreement statistics
- **THEN** the "Inter-Rater Agreement" accordion panel SHALL be visible, showing the overall Kappa value, initial agreement rate, per-group breakdown, and small-sample guidance

#### Scenario: Agreement section hidden in single-reviewer mode

- **WHEN** the Preview step is loaded in single-reviewer mode
- **THEN** no "Inter-Rater Agreement" section SHALL be rendered in the QC Summary accordion

#### Scenario: Kappa displayed with confidence interval

- **WHEN** the computed Kappa is 0.82 with CI [0.71, 0.90]
- **THEN** the overall statistics table SHALL display `"0.82 [0.71, 0.90]"` in the Kappa row

#### Scenario: Per-group N/A for small groups

- **WHEN** a MetadataGroup has insufficient data (`kappa: null`)
- **THEN** the per-group table row for that group SHALL display `"N/A"` in the Kappa column and still display the initial agreement rate

### Requirement: Pure TypeScript Implementation

All inter-rater agreement computations (Cohen's κ, Fleiss' κ, confidence intervals, agreement rates) SHALL be implemented in pure TypeScript without external statistical library dependencies. The implementation SHALL reside in `src/lib/interRaterAgreement.ts`.

#### Scenario: No external dependency imported

- **WHEN** `src/lib/interRaterAgreement.ts` is inspected
- **THEN** the file SHALL contain no `import` statements referencing packages outside the project's existing dependency tree (no `jstat`, `simple-statistics`, `mathjs`, etc.)

#### Scenario: Module exports expected functions

- **WHEN** `src/lib/interRaterAgreement.ts` is imported
- **THEN** it SHALL export at minimum `cohensKappa` and `fleissKappa` functions with the signatures defined in this spec

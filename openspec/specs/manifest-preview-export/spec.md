# manifest-preview-export Specification

## Purpose

Define manifest preview presentation and export behavior.

## Requirements

### Requirement: Manifest Preview Accordion Layout

Manifest preview SHALL use separated, independently collapsible accordion panels, all initially open, adding Inter-Rater Agreement only for multi-reviewer mode in the specified order.

#### Scenario: Preview initializes its accordion panels

- **WHEN** a single- or multi-reviewer manifest preview first renders
- **THEN** panel count, order, and initial expansion SHALL follow these rules:

The manifest preview SHALL render all sections inside a Mantine `Accordion` with `multiple` and `variant="separated"`. Single-reviewer mode SHALL contain four panels: Study Parameters, Software Manifest, QC Summary, and Pipeline Summary. Multi-reviewer mode SHALL contain five panels: Study Parameters, Software Manifest, QC Summary, Inter-Rater Agreement, and Pipeline Summary. Inter-Rater Agreement SHALL appear between QC Summary and Pipeline Summary. All rendered panels SHALL default open so full content is visible on first render; users MAY collapse individual panels.

#### Scenario: Accordion layout defaults to all open

- **WHEN** the Manifest Preview page is loaded
- **THEN** every rendered accordion panel SHALL be visible and expanded by default

#### Scenario: Single-reviewer mode shows four panels

- **WHEN** `reviewers` contains at most one entry or is undefined
- **THEN** exactly four panels SHALL render, with no Inter-Rater Agreement panel

#### Scenario: Multi-reviewer mode shows five panels

- **WHEN** `reviewers` contains at least two entries
- **THEN** five panels SHALL render in order: Study Parameters, Software Manifest, QC Summary, Inter-Rater Agreement, Pipeline Summary

### Requirement: Final Verdict Computation

Preview/export SHALL use SubjectSession resolution when present, otherwise unanimous reviewer status, otherwise unresolved disagreement. Unresolved disagreements SHALL block Preview & Export. A sole reviewer SHALL supply its final verdict from its indexed slice without a separate flat-map path. QC counts and metric aggregation SHALL use these final verdicts exclusively; output formats and methods content SHALL remain unchanged.

#### Scenario: Resolved verdict takes precedence

- **WHEN** reviewers disagree and a resolution exists
- **THEN** its status SHALL supply the final verdict

#### Scenario: Unanimous verdict used without resolution

- **WHEN** every reviewer agrees and no resolution exists
- **THEN** that unanimous status SHALL supply the final verdict

#### Scenario: Single-reviewer mode uses sole verdict

- **WHEN** the sole reviewer's indexed slice contains Pass
- **THEN** the final verdict SHALL be Pass

### Requirement: Manifest Section 1 Study Parameters

Study Parameters SHALL show assignment-based group inventory counts and stored metadata with the specified conditional omissions and array/context formatting, distinguishing participants, visits, and runs.

#### Scenario: Group inventory and acquisition parameters are summarized

- **WHEN** Study Parameters renders imported metadata groups
- **THEN** counting units, membership scope, omitted fields, and display formatting SHALL follow these rules:

The manifest preview SHALL render a "Study Parameters" section. For each `MetadataGroup` defined in the project's import snapshot, the section SHALL render one table with the group's `label` as a subheading and rows containing:

- N Participants (unique `SubjectInfo.subject` identities among assigned inventory entries, with an optional leading `sub-` removed)
- N Subject-Sessions (count of SubjectSession inventory entries assigned to the group)
- N Total Runs (Σ `aslRuns.length` across group members)
- The group's stored `bidsParams` entries, using raw sidecar keys rather than humanized parameter names

Null or undefined values and keys `id` and `label` SHALL be omitted. `LabelingDuration` SHALL be omitted for PASL, and `BolusCutOffDelayTime` SHALL be omitted when `BolusCutOffFlag` is false or absent. Other scalar values SHALL render as stored text without added unit normalization. `ASLContext` SHALL use its display summary. Arrays SHALL render all stringified entries in brackets without a suffix when at most five distinct stringified values exist. Otherwise, they SHALL render the first five original entries in order, stringified, followed by `, … (+N more unique values)` inside the brackets, where N is the total number of distinct stringified values minus five.

Subject-sessions SHALL mean participant visits (GUI/BIDS Sessions, ExploreASL Visits), not ASL runs (ExploreASL Sessions). Participant identity SHALL come from `SubjectInfo.subject`, never splitting the composite `subjectSession` key. Group membership and inventory scope SHALL remain assignment-based and SHALL NOT exclude No Info entries from Study Parameters. A participant MAY belong to different groups across visits and SHALL count once within each group containing that participant.

#### Scenario: Repeated visits do not inflate participant counts

- **WHEN** three participants each have two visits in the inventory and all six SubjectSessions belong to one metadata group
- **THEN** Study Parameters SHALL report N Participants 3, N Subject-Sessions 6, and the unchanged sum of ASL runs in preview, Markdown, and HTML

#### Scenario: PCASL group shows Labeling Duration

- **WHEN** a metadata group has `ArterialSpinLabelingType: "PCASL"` and `LabelingDuration: 1800`
- **THEN** the rendered Section 1 table for that group SHALL include a `"LabelingDuration"` row with value `"1800"`, without adding units

#### Scenario: PASL group omits Labeling Duration

- **WHEN** a metadata group has `ArterialSpinLabelingType: "PASL"`
- **THEN** the rendered Section 1 table for that group SHALL NOT include a `"LabelingDuration"` row

#### Scenario: Ungrouped subject-sessions bucket

- **WHEN** SubjectSessions exist with no assignment or an assignment referencing no defined `MetadataGroup`
- **THEN** Section 1 SHALL render an additional "Ungrouped" subheading with N Participants, N Subject-Sessions, and N Total Runs computed across ungrouped inventory entries using the same identity/count rules, without parameter rows

The same Ungrouped membership SHALL apply to QC Summary and inter-rater agreement in preview and exports, consistent with QC Selection.

### Requirement: Manifest Section 2 Software Manifest

Software Manifest SHALL display recorded-version precedence with labeled current fallbacks and available processing configuration using shared semantics-preserving path redaction, without claiming an immutable execution snapshot.

#### Scenario: Software versions and available configuration are presented

- **WHEN** Software Manifest renders recorded values and fallback sources
- **THEN** version precedence, configuration source, redaction, and disclosure SHALL follow these rules:

The preview SHALL render a "Software Manifest" section containing two sub-sections with `Title order={5}` sub-headings:

#### Sub-section: Versions

A 3-row table with columns `Software` / `Version`, listing:

- ExploreASL Version (the nonempty `uiState.processing.population.lastRun.exploreASLVersion`, otherwise the active execution profile's `exploreAslVersion`, otherwise `"unknown"`)
- ExploreASL GUI Version (from `uiState.processing.population.lastRun.guiVersion`, otherwise build-time `VITE_APP_VERSION`, otherwise `"unknown"`)
- MATLAB Version (from `uiState.processing.population.lastRun.matlabVersion`, or `"unknown"` if absent)

For this display fallback, the active execution profile SHALL be the configured `selectedProfileId` when that profile exists, otherwise the first profile whose validation state is valid. Nonempty recorded run versions, including a recorded `"unknown"`, SHALL take precedence over settings/build fallbacks. Profile fallbacks SHALL be suffixed `" (current profile; not recorded run)"`; GUI build fallbacks SHALL be suffixed `" (current GUI build; not recorded run)"`. Preview fallback SHALL NOT replace recorded Population provenance or imply software used for every SubjectSession or earlier processing module.

#### Sub-section: ExploreASL Data Parameter Configuration

When `dataPar` is non-empty, the preview SHALL render a `<Code block>` (Mantine) containing the full `dataPar` object serialised as pretty-printed JSON (`JSON.stringify(..., null, 2)`), after the following sanitisation:

- Subject-selection expressions, including `x.dataset.subjectRegexp`, and inclusion identifiers, including `x.dataset.ForceInclusionList`, SHALL be preserved exactly. Absent selection/inclusion fields SHALL NOT be inserted.
- Machine-local filesystem paths SHALL be redacted recursively, retaining their final path component as `[redacted path]/<name>` (or `[redacted path]` when no final component exists). Location fields with names ending in `path`, `dir`, `folder`, or `root` (case-insensitive) and absolute POSIX, Windows-drive, UNC, or home-relative path strings SHALL be redacted; selection expressions and inclusion identifiers SHALL be exempt. Numeric/scientific settings SHALL remain unchanged.

One shared sanitisation function SHALL serve preview, Markdown, HTML, and configuration-derived Methods text without mutating stored `dataPar`. A visible note SHALL explain path redaction and preservation of selection/inclusion settings without another execution disclaimer.

The source SHALL be the available `<project_root>/derivatives/ExploreASL/dataPar.json` file, normally written during native processing preparation. Its contents SHALL NOT be represented as an immutable snapshot tied to the recorded Population run or all included subjects.

A spec-level reservation SHALL note that human-readable label translation of `dataPar.json` keys is a future expansion point — no v0 implementation required.

#### Scenario: dataPar code block preserves analytical selection

- **WHEN** the most recent `dataPar.json` contains `x.dataset.subjectRegexp: "^sub-(?!excluded).*"` and `x.dataset.ForceInclusionList: ["sub-01"]`
- **THEN** Section 2's data parameter code block SHALL retain both the exact regex and the inclusion list
- **AND** any machine-local path such as `x.opts.subjectFolder: "/private/study"` SHALL display as `"[redacted path]/study"` without modifying the stored configuration

#### Scenario: Unknown version placeholder

- **WHEN** neither a recorded ExploreASL version nor a version from the selected or fallback profile is available at preview time
- **THEN** Section 2 SHALL render the ExploreASL Version row with value `"unknown"`

#### Scenario: Missing run versions use display fallbacks

- **WHEN** run version fields are absent, the selected execution profile records ExploreASL `"1.12.0"`, and `VITE_APP_VERSION` is `"0.1.2"`
- **THEN** Section 2 SHALL display ExploreASL `"1.12.0 (current profile; not recorded run)"`, GUI `"0.1.2 (current GUI build; not recorded run)"`, and MATLAB `"unknown"`
- **AND** Methods SHALL NOT attribute those current settings to processing or add an inventory of missing versions

#### Scenario: Missing selected profile uses first valid profile

- **WHEN** no recorded ExploreASL version exists and `selectedProfileId` matches no profile
- **THEN** the ExploreASL display version SHALL come from the first valid execution profile, or SHALL be `"unknown"` if that profile has no version or no valid profile exists

#### Scenario: Recorded versions remain preferred provenance

- **WHEN** recorded Population versions differ from current execution-profile or GUI build versions
- **THEN** Section 2 and Methods SHALL use the recorded versions without rewriting them
- **AND** Methods SHALL NOT add a current-profile explanation

### Requirement: Manifest Section 3 Qc Summary

QC Summary SHALL aggregate eligible final verdicts and metric-specific final-Pass subject-session values, displaying sample SD, contributing counts, and reviewer-mode agreement without collapsing repeated visits.

#### Scenario: Final verdicts and available QC metrics are summarized

- **WHEN** preview or document export builds per-group QC tables
- **THEN** eligibility, aggregation, units, missing values, and numeric formatting SHALL follow these rules:

The preview SHALL render a "QC Summary" section. For each `MetadataGroup` with an eligible final verdict, the section SHALL render a subheading and a table with rows:

- Metadata group name (group `label`)
- Pass / Total (subject-sessions) (count with final verdict Pass / count with final verdict Pass or Fail, displayed as `"N / Total"`)
- Mean ASL Coverage Percentage & SD (mean and sample standard deviation across final-Pass group members' `Coverage.tsv`, formatted as `"mean (SD)"`)
- Mean Spatial Coefficient of Variation in Gray Matter & SD (mean and sample standard deviation across final-Pass group members' `SpatialCoV.tsv`, formatted as `"mean (SD)"`)
- Mean Motion in mm RMS & SD (maximum across each final-Pass SubjectSession's ASL runs, then mean and sample standard deviation across group members, formatted as `"mean (SD)"`)
- Mean Motion Exclusion Percentage & SD (as emitted by ExploreASL; mean and sample standard deviation across final-Pass group members, formatted as `"mean (SD)"`)

Rows with final verdict Fail SHALL be excluded from all QC metric aggregations but SHALL count toward the Total denominator. No Info rows SHALL be excluded from numerator and denominator. Pass / Total SHALL therefore render `"<passCount> / <passCount + failCount>"`.

Preview, Markdown, and HTML SHALL label Pass / Total as subject-sessions and visibly explain that its reviewed units are participant visits, not unique participants, excluding No Info. The same note SHALL explain that metric n counts final-Pass subject-sessions contributing an available value for that metric. Repeated visits SHALL NOT be collapsed for QC counts or aggregation; eligibility, final-verdict resolution, averaging, and maximum-across-runs motion aggregation SHALL remain unchanged.

Numeric means and SDs SHALL render with two decimal places. When a group has fewer than 2 available Pass metric values, the SD component SHALL be rendered as the literal `"N/A"` (sample SD undefined for n < 2), with an available mean rendered to two decimal places. When no metric value is available, the base value SHALL be `"N/A"`. Each metric cell SHALL append `"; n=N"`, where N counts final-Pass SubjectSessions contributing an available value for that metric, excluding null and undefined. Motion SHALL contribute at most one value per SubjectSession after the existing maximum-across-runs aggregation. Counts SHALL be metric-specific, not the group's Pass count; these rules apply equally to named and Ungrouped groups in preview, Markdown, and HTML.

In multi-reviewer mode, each per-group QC Summary table SHALL include an Initial Agreement Rate column showing the percentage of eligible SubjectSessions where all reviewers' statuses were unanimous before resolution, formatted as `"N%"`. This column SHALL be omitted in single-reviewer mode.

#### Scenario: Pass / Total with mixed verdicts

- **WHEN** a metadata group has 10 SubjectSessions: 7 final Pass, 2 final Fail, 1 No Info
- **THEN** Section 3's "Pass / Total" cell for that group SHALL render `"7 / 9"` (No Info row excluded from both numerator and denominator)

#### Scenario: Fail rows excluded from coverage mean and SD

- **WHEN** a metadata group has 3 SubjectSessions: 2 final Pass (coverage 95%, 90%) and 1 final Fail (coverage 50%)
- **THEN** the "Mean ASL Coverage Percentage & SD" cell SHALL render `"92.50 (3.54); n=2"` (mean and sample standard deviation of 95 and 90, Fail excluded)

#### Scenario: SD renders N/A for single-subject group

- **WHEN** a metadata group has 1 SubjectSession with final verdict Pass and coverage 88%
- **THEN** the "Mean ASL Coverage Percentage & SD" cell SHALL render `"88.00 (N/A); n=1"`

#### Scenario: Missing metrics have independent contributing counts

- **WHEN** two final-Pass SubjectSessions contribute coverage, only one contributes Spatial CoV, and neither has available motion
- **THEN** coverage SHALL show n=2, Spatial CoV SHALL show n=1, and motion SHALL show `"N/A; n=0"`

#### Scenario: Motion aggregation uses worst run per subject

- **WHEN** a SubjectSession has 3 ASL runs with motion RMS values `[0.4, 0.7, 0.5]` mm, and its final verdict is Pass
- **THEN** the SubjectSession's contribution to the group's Mean Motion aggregation SHALL be `0.7` (max across runs)

#### Scenario: Initial agreement rate shown in multi-reviewer mode

- **WHEN** a group has 20 eligible SubjectSessions and all reviewers initially agreed on 16
- **THEN** the group's Initial Agreement Rate column SHALL display `"80%"`

#### Scenario: Initial agreement rate hidden in single-reviewer mode

- **WHEN** the project has at most one reviewer
- **THEN** QC Summary tables SHALL omit the Initial Agreement Rate column

### Requirement: Inter-Rater Agreement Section

Multi-reviewer preview SHALL display an agreement panel with the specified overall and per-group rates, Kappa intervals, subject-session counts, and interpretation guidance, omitting it for one reviewer.

#### Scenario: Preview formats multi-reviewer agreement

- **WHEN** the agreement section is rendered
- **THEN** tables, count units, undefined values, and guidance SHALL follow these rules:

In multi-reviewer mode, preview SHALL render an "Inter-Rater Agreement" accordion panel between QC Summary and Pipeline Summary. Its overall table SHALL show Number of Reviewers, Overall Initial Agreement Rate formatted as `"N% (agreed/total)"`, Cohen's Kappa for exactly two reviewers or Fleiss' Kappa for more reviewers with unclamped 95% confidence interval formatted as `"κ = 0.82 [0.71, 0.90]"`, Number of Subject-Sessions, and Subject-Sessions Requiring Resolution. A per-group table SHALL show group label, n (subject-sessions), Initial Agreement Rate formatted as `"N% (agreed/total)"`, and Kappa with CI or `"N/A"` when undefined. These counts SHALL retain the existing eligible, completely rated SubjectSession units, not unique participants. The QC Summary's Initial Agreement Rate SHALL remain percentage-only.

Below the tables, the section SHALL display: `Initial agreement is unadjusted. Kappa adjusts for agreement expected from each reviewer's pass/fail frequencies; interpret kappa and its confidence interval cautiously with small subject-session counts.` The entire section SHALL be omitted in single-reviewer mode.

#### Scenario: Agreement section displayed in multi-reviewer mode

- **WHEN** two reviewers rate 50 eligible SubjectSessions, agree initially on 43, and disagree on 7
- **THEN** the section SHALL show 2 reviewers, `"86% (43/50)"`, Kappa with 95% CI, 50 subject-sessions, 7 subject-sessions requiring resolution, and small-sample guidance

#### Scenario: Agreement section omitted in single-reviewer mode

- **WHEN** the project has at most one reviewer
- **THEN** no Inter-Rater Agreement panel SHALL render

#### Scenario: Per-group preview agreement includes counts

- **WHEN** a group's only eligible SubjectSession has unanimous reviewer verdicts
- **THEN** its Inter-Rater Agreement table row SHALL show `"100% (1/1)"`, while its QC Summary Initial Agreement Rate SHALL show `"100%"`

#### Scenario: Kappa method depends on reviewer count

- **WHEN** exactly two reviewers exist
- **THEN** Cohen's Kappa SHALL be used; with three or more reviewers, Fleiss' Kappa SHALL be used

### Requirement: Manifest Section 4 Pipeline Summary Paragraph

Pipeline Summary SHALL introduce globally deduplicated participants, included subject-sessions, and covered groups with correct pluralization, leaving scientific processing descriptions to Methods.

#### Scenario: Pipeline Summary introduces manifest coverage

- **WHEN** included inventory is summarized
- **THEN** counts, Ungrouped handling, and excluded narrative SHALL follow these rules:

The preview SHALL render a "Pipeline Summary" section with an opening paragraph stating the number of unique participants, included subject-sessions, and groups covered by the manifest. The paragraph SHALL use correct singular and plural forms. It SHALL substitute:

- Participant count → unique normalized `SubjectInfo.subject` identities across all included SubjectSessions (excluding No Info), deduplicated globally rather than summed across groups
- Subject-session count → total SubjectSessions included in the manifest (excluding No Info)
- Group count → metadata group count plus an Ungrouped bucket when present

The opening paragraph SHALL NOT repeat execution-evidence qualifications or describe mutable execution-profile settings. Scientific processing descriptions SHALL appear in Methods.

#### Scenario: Participants deduplicate across groups while visits remain observations

- **WHEN** three participants each have two included visits, with participant A's visits and B's first visit in Group A, B's second visit in Group B, and C's visits Ungrouped
- **THEN** Study Parameters SHALL report participants/subject-sessions as 2/3 for Group A, 1/1 for Group B, and 1/2 for Ungrouped
- **AND** the summary SHALL report 3 unique participants with 6 included subject-sessions across 3 groups, not 4 participants or 6 subjects
- **AND** excluding a No Info visit SHALL reduce the included subject-session count, but SHALL remove its participant only when no other included visit remains

#### Scenario: Unknown versions substituted in paragraph

- **WHEN** Population `lastRun` version fields and applicable profile/build version fallbacks are unavailable and the user previews the manifest
- **THEN** Section 2 SHALL show `"unknown"` for unavailable versions
- **AND** the count-only opening paragraph and Methods SHALL NOT add an inventory of missing versions

#### Scenario: Singular summary

- **WHEN** the manifest covers one participant, one included subject-session, and one group
- **THEN** the opening paragraph SHALL use `participant`, `subject-session`, and `group` in the singular

#### Scenario: Paragraph is static for v0

- **WHEN** `dataPar.json` has `bPVCNativeSpace: true` in one project and `bPVCNativeSpace: false` in another project (otherwise identical)
- **THEN** the opening Pipeline Summary paragraphs SHALL be identical with the same counts, while Methods SHALL reflect the corresponding processing choices

### Requirement: Methods And References Subsections

One shared generator SHALL produce source-supported Methods, a separate verification disclaimer, and unique sorted references for preview and document exports, preserving parameter semantics and omitting invented scientific claims.

#### Scenario: Available processing configuration generates Methods and References

- **WHEN** preview, Markdown, or HTML generates the processing narrative
- **THEN** paragraph order, defaults, scientific meanings, redaction, and missing-configuration behavior SHALL follow these rules:

Preview, Markdown, and HTML SHALL show Methods and References subsections under Pipeline Summary when their respective generated lists are nonempty. One shared generator SHALL produce the Methods paragraphs, a separate disclaimer, and sorted unique references for all formats.

The disclaimer SHALL read: `This Methods draft reflects the dataPar.json available when this manifest was generated. Authors should verify that it describes the processing performed before publication.` Each output SHALL display it once above any Methods narrative. It SHALL NOT appear within a scientific paragraph.

For an available configuration, Methods SHALL contain five paragraphs in this order:

1. Import, distinguishing existing BIDS input from completed DICOM conversion and including available software versions without guessed versions.
2. Subject-session inclusion and exclusion rules, generated from the supported selection and skip settings without calculating affected scan or subject counts.
3. Structural processing, including relevant segmentation, registration, and lesion-handling settings.
4. ASL processing, including relevant motion, registration, calibration, quantification, masking, and partial-volume correction settings.
5. Population processing, including a generated list of atlas and tissue extraction choices.

The generator SHALL use the available file settings and only the fixed defaults verified against operative code in the local ExploreASL 2.0.0_BETA checkout. It SHALL distinguish omitted, false, zero, and empty settings according to their consumers. GUI display placeholders SHALL NOT supply processing defaults. Data-dependent choices SHALL use conditional scientific descriptions rather than guessed values or claims that every subject-session had the required inputs.

The narrative SHALL use manuscript-style scientific prose and the supplied unslop writing rules. It SHALL NOT contain repeated requested/selected/not-verified warnings, inventories of unknown versions, mutable-profile explanations, raw flag arrays, or GPT-style filler. Scientific acronyms, units, and citations SHALL remain correct. Missing versions and unsupported settings SHALL be omitted rather than invented. An absent configuration SHALL produce no Methods paragraphs, references, or disclaimer. An available empty configuration SHALL produce the five paragraphs using source-supported defaults.

The shared path-redaction function SHALL continue to protect machine-local paths without changing stored configuration, subject selection, or inclusion identifiers. The configuration display note SHALL retain its path-redaction explanation without another execution disclaimer. The Software Manifest version table SHALL retain recorded-version precedence, labeled current-profile/current-build fallbacks, and recorded `unknown` values.

Descriptions SHALL respect supported parameter meanings: numeric M0 is scalar calibration, not a separate scan; an explicitly supplied absolute motion threshold, including zero, takes precedence over the relative ENABLE threshold, which is fractional t-statistic improvement rather than a Z-score; PVC flat dimensions use voxels and Gaussian FWHM uses millimeters; registration settings SHALL NOT imply unrecorded M0-to-T1w alignment. Data-dependent physiological values SHALL NOT be invented.

#### Scenario: Dynamic methods and references populated

- **WHEN** an available configuration specifies lesion filling, separate-scan M0 calibration, native-space PVC, and Population extraction settings
- **THEN** the generator SHALL produce the five paragraphs in the required order and the separate disclaimer
- **AND** references SHALL be unique, sorted, and relevant to the described methods

#### Scenario: Sparse configuration does not invent scientific methods

- **WHEN** an available configuration omits parameters with fixed defaults in the audited ExploreASL code
- **THEN** Methods SHALL describe those default workflow choices without merging GUI placeholders
- **AND** field-strength-dependent physiological values and other unresolved data-dependent values SHALL NOT be invented

#### Scenario: Existing BIDS input is not DICOM conversion

- **WHEN** the project uses existing BIDS input
- **THEN** the import paragraph SHALL describe that input workflow without claiming that the GUI converted DICOM data

#### Scenario: Current container profile does not rewrite run evidence

- **WHEN** the recorded Population run names ExploreASL version 2.1 and the current profile selects Apptainer with ExploreASL version 3.0
- **THEN** any ExploreASL version included in Methods SHALL retain 2.1
- **AND** Methods SHALL NOT add a current-profile explanation or an unknown-version inventory

### Requirement: Methods inclusion and exclusion rules

Methods SHALL describe configured initial selection and separate Structural skip rules with operative precedence and defaults, without evaluating cohort counts or inventing unsupported skip options.

#### Scenario: Methods describes dataset selection and Structural prerequisites

- **WHEN** inclusion, exclusion, and SkipIfNo settings are narrated
- **THEN** precedence, preserved identifiers, default behavior, and interpretation limits SHALL follow these rules:

The inclusion paragraph SHALL describe initial dataset selection and the separate Structural module skip rules. `ForceInclusionList`, when present, SHALL take precedence over `subjectRegexp` for initial selection. Exact `exclusion` identifiers SHALL apply afterward. The default selection expression SHALL be `^sub-.*$`. The generator SHALL preserve supplied expressions and identifiers without evaluating the regex or calculating cohort sizes.

The operative `SkipIfNoASL`, `SkipIfNoFlair`, and `SkipIfNoM0` flags SHALL default off. An enabled flag SHALL describe skipping Structural processing for a participant visit when the corresponding resolved input image is absent. It SHALL NOT describe cohort-wide exclusion, checking every ASL run, or a guarantee of successful processing when a skip flag is disabled. Missing T1w SHALL be described as a Structural skip condition without inventing a `SkipIfNoT1` option. Unsupported aliases SHALL NOT acquire behavior. No inventory scans or affected-scan counts SHALL be required.

#### Scenario: Independent missing-input rules

- **WHEN** missing-ASL and missing-FLAIR skip rules are enabled while the missing-M0 rule is disabled
- **THEN** the paragraph SHALL describe the enabled Structural skip conditions without removing visits from the study, adding a missing-M0 rule, or claiming that every retained visit had an M0 image

#### Scenario: Selection identifiers remain exact

- **WHEN** the available dataPar.json contains a subject-selection expression and explicit inclusion identifiers
- **THEN** their supported selection roles SHALL appear in the inclusion paragraph without replacing their values or calculating a resulting cohort size

### Requirement: Methods Population extraction description

Population Methods SHALL describe indexed extraction choices and operative defaults, units, masks, and WMH handling without repairing mismatched arrays or implying unsupported extraction behavior.

#### Scenario: Methods describes Population ROI extraction

- **WHEN** image, atlas, tissue, threshold, masking, and WMH settings are narrated
- **THEN** indexed choices, absent-versus-empty defaults, and scientific distinctions SHALL follow these rules:

The Population paragraph SHALL describe image types, atlases, tissues, thresholds, masking, WMH inclusion, and minimum ROI volume according to their operative extraction settings. Each atlas, tissue, and threshold at the same index SHALL define one extraction choice. Duplicate atlas entries SHALL remain separate when their tissues or thresholds differ. Selected image types SHALL apply to these choices as the source's outer loop. Atlas display labels SHALL use the existing label map where available. Mismatched selection arrays SHALL NOT be silently repaired or described as a valid extraction list.

When all three selection fields are absent, the paragraph SHALL describe the source defaults: Total with GM thresholds 0.7 and 0.5, DeepWM with WM threshold 0.5, and Tatu_ACA_MCA_PCA with GM thresholds 0.7 and 0.5. Missing thresholds for matching supplied atlas and tissue arrays SHALL default to 0.7. Explicit empty atlas and tissue arrays SHALL NOT invoke absent-field defaults. Missing or empty `DataTypes` SHALL use qCBF.

Thresholds SHALL identify the tissue or extraction choice they constrain and SHALL describe a strict greater-than test on the selected or summed tissue partial volumes. Minimum ROI volume SHALL use mL and default to 1 for ordinary atlas extraction. `bWMH` SHALL describe retaining existing WMH contributions in tissue partial volumes or subtracting them when false, not WMH detection or unconditional inclusion of every WMH voxel. The mask tuple SHALL refer to Population extraction masks. Disabled tissue masking SHALL NOT be described as applying a tissue-probability threshold or tissue-based regional PVC. Native-space ASL PVC SHALL NOT imply native-space Population extraction.

#### Scenario: Atlas and tissue extraction choices

- **WHEN** Population settings select multiple atlases and tissue extraction choices
- **THEN** the paragraph SHALL enumerate their source-supported extraction relationship with the corresponding threshold meanings and units
- **AND** it SHALL NOT describe WMH inclusion as WMH detection

#### Scenario: Explicit disabled extraction

- **WHEN** the configuration disables a Population extraction choice according to its operative reader
- **THEN** the paragraph SHALL NOT describe that choice as performed or replace it with a GUI display default

### Requirement: Live Preview Updates On Verdict Changes

The preview SHALL update live when the user navigates back to QC Selection, changes verdicts for any reviewer, and returns to Preview & Export. Final verdicts SHALL be recomputed from current reviewer and resolved verdicts on each render. No manual refresh or export SHALL be needed.

#### Scenario: Counts update after toggling Fail to Pass

- **WHEN** the user navigates back to QC Selection, flips a reviewer verdict from Fail to Pass, and returns to Preview & Export
- **THEN** the Pass / Total cell SHALL reflect the recomputed final verdict count

#### Scenario: Agreement stats update after verdict change

- **WHEN** changing a reviewer verdict changes initial agreement or introduces a disagreement
- **THEN** the Inter-Rater Agreement section SHALL reflect updated agreement and Kappa values on return

### Requirement: Markdown And HTML Export

Markdown and HTML exports SHALL serialize the manifest through native save dialogs with deterministic content, reviewer-mode agreement, shared path redaction, and self-contained HTML rather than WebView printing.

#### Scenario: A user exports the manifest as Markdown or HTML

- **WHEN** the corresponding export button is enabled and selected
- **THEN** writing, formatting, reviewer statistics, redaction, and format-specific presentation SHALL follow these rules:

The preview SHALL expose "Export Markdown" and "Export HTML" buttons. Clicking either SHALL open a Tauri save dialog and write the formatted manifest file at the chosen path. Both formats SHALL be byte-identical across Windows 11, macOS, and Linux for the same input state.

- Markdown: produced by a TS template literal; written via `@tauri-apps/plugin-fs` `writeTextFile`.
- HTML: produced by templating the same Markdown payload into an inline-CSS single-file wrapper. The wrapper SHALL include all CSS inline; SHALL NOT reference external stylesheets; SHALL NOT invoke the WebView rendering pipeline (no `webview.printToPdf`).

Both buttons SHALL be disabled when no reviewer has any stored verdict entry. Markdown and HTML SHALL use the preview's separate participant/subject-session counts and QC denominator labels/note. In multi-reviewer mode, Markdown and HTML SHALL include Inter-Rater Agreement between QC Summary and Pipeline Summary with the preview's reviewer count, overall and per-group Initial Agreement Rate, Kappa and unclamped CI, subject-sessions requiring resolution, and Kappa guidance. Overall and per-group n SHALL be labeled as subject-sessions. Single-reviewer exports SHALL omit this section.

In the exported formats, the "ExploreASL Data Parameter Configuration" sub-section SHALL be rendered as a fenced JSON code block (` ```json ``` ` in Markdown; `<pre><code>…</code></pre>` in HTML), using the same semantics-preserving path redaction and path-redaction note as the preview. The HTML wrapper SHALL include `pre` / `pre code` CSS rules for legible monospace rendering.

In Markdown and HTML, overall Initial Agreement Rate SHALL include percentage and agreed/total counts, while per-group Initial Agreement Rate SHALL remain percentage-only, unlike the preview's Inter-Rater Agreement per-group table. QC Summary rates SHALL remain percentage-only in preview and exports.

A spec-level reservation SHALL note that a "Export PDF" button is a future expansion point, not part of v0.

#### Scenario: Markdown export writes file

- **WHEN** the user clicks "Export Markdown", chooses a path, and confirms the save dialog
- **THEN** a UTF-8 text file SHALL exist at the chosen path whose content matches the manifest preview rendered as Markdown

#### Scenario: HTML export is self-contained

- **WHEN** the user clicks "Export HTML", chooses a path, and confirms
- **THEN** the resulting HTML file SHALL contain all CSS inline, SHALL contain no `<link>` tags referencing external stylesheets, and SHALL render correctly when opened directly from disk without a server

#### Scenario: Identical output across platforms

- **WHEN** the same `uiState.manifest` state is exported on Windows 11, macOS, and Linux
- **THEN** the byte content of the Markdown file SHALL be identical across the three OSes, and the byte content of the HTML file SHALL be identical across the three OSes

#### Scenario: Export disabled with no verdicts

- **WHEN** no reviewer has any stored verdict entry
- **THEN** both export buttons SHALL render in a disabled state

#### Scenario: Multi-reviewer exports include agreement section

- **WHEN** a multi-reviewer project exports Markdown or HTML
- **THEN** output SHALL include Inter-Rater Agreement data and Kappa guidance between QC Summary and Pipeline Summary

#### Scenario: Exported per-group agreement remains percentage-only

- **WHEN** a multi-reviewer project exports Markdown or HTML for a group with one unanimous eligible SubjectSession
- **THEN** its exported per-group agreement rate SHALL be `"100%"`, while the preview's Inter-Rater Agreement table SHALL display `"100% (1/1)"`

#### Scenario: Single-reviewer exports omit agreement section

- **WHEN** a single-reviewer project exports Markdown or HTML
- **THEN** output SHALL omit Inter-Rater Agreement

### Requirement: CSV Export

Manifest preview SHALL offer native UTF-8 CSV export using the authoritative CSV capability's mode-specific columns and escaping, disabled when no verdict exists.

#### Scenario: A user exports the manifest as CSV

- **WHEN** CSV export is displayed or selected for the current reviewer mode
- **THEN** button placement, output schema, and disabled state SHALL follow these rules:

The preview SHALL expose an "Export CSV" button after "Export Markdown" and "Export HTML". Clicking it SHALL open a Tauri save dialog and write UTF-8 CSV. The `manifest-csv-export` capability is authoritative for exact content, mode-specific columns, QC metric names, agreement statistics, escaping, and `\n` line endings.

Multi-reviewer columns SHALL be `SubjectSession`; registry-ordered `Reviewer_N_Verdict`, `Reviewer_N_Reason`, and `Reviewer_N_Notes` triplets; `Final_Verdict`; `Resolution_Notes`; `Coverage_Pct`; `SpatialCoV`; `Motion_mm`; and `Motion_Exclusion_Pct`. Single-reviewer columns SHALL be `SubjectSession`, `Verdict`, `Reason`, `Notes`, `Coverage_Pct`, `SpatialCoV`, `Motion_mm`, and `Motion_Exclusion_Pct`. Single-reviewer CSV SHALL contain no final/resolution/per-reviewer columns or agreement section. The button SHALL be disabled when no verdict exists.

#### Scenario: Multi-reviewer CSV uses numbered reviewer columns

- **WHEN** a two-reviewer project exports CSV
- **THEN** output SHALL contain two registry-ordered reviewer triplets, final and resolution fields, and exact QC metric columns

#### Scenario: CSV export disabled with no verdicts

- **WHEN** no reviewer has any stored verdict entry
- **THEN** Export CSV SHALL be disabled

#### Scenario: Single-reviewer CSV uses simplified columns

- **WHEN** a single-reviewer project exports CSV
- **THEN** its header SHALL be `SubjectSession,Verdict,Reason,Notes,Coverage_Pct,SpatialCoV,Motion_mm,Motion_Exclusion_Pct` and no agreement section SHALL appear

### Requirement: ManifestPreview uses summarizeAslContext for ASLContext display

Study Parameters SHALL summarize ASL context for display only, preserving raw persisted metadata and existing raw-field iteration and conditional omissions.

#### Scenario: Study Parameters renders stored ASL context

- **WHEN** `ManifestPreview` encounters the `ASLContext` metadata key
- **THEN** display-only transformation and unchanged persistence SHALL follow these rules:

`ManifestPreview.tsx` §1 study parameters table SHALL render `summarizeAslContext(group.bidsParams.ASLContext)` instead of the raw ASLContext string when displaying the `ASLContext` field. Raw ASLContext persists in `mappingState.bidsParams.ASLContext` (per `metadata-grouping-ui` spec) — the summary form is display-only.

Existing behavior for other `bidsParams` fields (conditional skipping of `LabelingDuration` for PASL, `BolusCutOffDelayTime` when `BolusCutOffFlag` is false) is preserved.

`ManifestPreview.tsx` continues to iterate `Object.entries(group.bidsParams)` (raw sidecar field rendering). Vendor/Sequence/LabelingType fields are review-panel display-only — NOT persisted in `mappingState.metadataGroups[].bidsParams` (per `project-store` confirmBidsReview spec).

#### Scenario: Manifest §1 shows ASLContext summary

- **WHEN** `ManifestPreview` renders §1 for a group whose `bidsParams.ASLContext` is the ds000240 raw 109-token string
- **THEN** the row displays `"m0scan x10, label-control pair x50"` (summarized form), not the raw comma-separated string

#### Scenario: Manifest §1 hides absent ASLContext

- **WHEN** `ManifestPreview` renders §1 for a group whose `bidsParams.ASLContext` is undefined (no aslcontext.tsv-based context, e.g., a DICOM-import project where `studyPar.json` omitted ASLContext)
- **THEN** the `ASLContext` row SHALL be omitted by the null-or-undefined value check

#### Scenario: Manifest §1 renders raw sidecar fields unmodified

- **WHEN** `ManifestPreview` renders §1 for a BIDS-direct group
- **THEN** fields like `Manufacturer: "Siemens"`, `PulseSequenceType: "spiral"`, `MRAcquisitionType: "3D"`, `ArterialSpinLabelingType: "PCASL"`, `M0Type: "Included"` render directly from `bidsParams` (post-schema transform values). `Vendor`, `Sequence`, `LabelingType` derived fields are NOT rendered (not in `bidsParams`).

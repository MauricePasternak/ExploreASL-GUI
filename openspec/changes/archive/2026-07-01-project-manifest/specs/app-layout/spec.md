## ADDED Requirements

### Requirement: Manifest Navbar Entry

The navbar SHALL include a "Manifest" entry in `PHASE_NAV` appended after the "Visualization" entry. The entry SHALL use a Tabler icon appropriate to the document/QC-report concept (e.g. `IconClipboardCheck` or `IconFileReport`). The entry SHALL be enabled when `canAccessPhase(project, "manifest")` returns `true`. When disabled, the entry SHALL be greyed out and non-clickable. When the navbar is collapsed, the entry SHALL display the icon with an accessible `aria-label` of "Manifest". When expanded, the entry SHALL display both the icon and the "Manifest" label.

#### Scenario: Navbar entry enabled after Population completion

- **WHEN** `canAccessPhase(project, "manifest")` returns `true`
- **THEN** the "Manifest" navbar entry SHALL be enabled and clickable

#### Scenario: Navbar entry disabled before Population completion

- **WHEN** `canAccessPhase(project, "manifest")` returns `false`
- **THEN** the "Manifest" navbar entry SHALL be disabled (greyed out, non-clickable)

#### Scenario: Collapsed navbar shows icon

- **WHEN** the navbar is collapsed and the "Manifest" entry is enabled
- **THEN** the chosen Tabler icon SHALL be visible with `aria-label="Manifest"`

#### Scenario: Expanded navbar shows icon and label

- **WHEN** the navbar is expanded and the "Manifest" entry is enabled
- **THEN** both the chosen icon and the text "Manifest" SHALL be visible

#### Scenario: Entry positioned after Visualization

- **WHEN** the navbar phases are rendered
- **THEN** the "Manifest" entry SHALL appear immediately after the "Visualization" entry

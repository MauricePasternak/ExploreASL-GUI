## Requirements

### Requirement: Desktop Rail UI

The application shell SHALL use a collapsible rail for desktop navigation instead of a fixed-width sidebar. The rail SHALL toggle between a collapsed width of 60px and an expanded width of 240px.

#### Scenario: Rail in collapsed state
- **WHEN** the rail is collapsed
- **THEN** it displays vertically centered icons, a right-facing chevron `›` at the top, a home icon pinned to the bottom, and no textual labels

#### Scenario: Rail in expanded state
- **WHEN** the rail is expanded
- **THEN** it displays side-by-side icons and labels, a left-facing chevron `‹` at the top with "Navigation" text, and a home icon pinned to the bottom with a "Return to home" label

### Requirement: UI State Persistence

The rail expansion state SHALL persist within a given project's `uiState` as a boolean (`navbarCollapsed`). This requirement intentionally binds presentation state to the project domain rather than global app settings.

#### Scenario: Toggling the rail inside a project
- **WHEN** a user clicks the chevron toggle while a project is loaded
- **THEN** the project's `navbarCollapsed` boolean is updated in memory and the project is marked as dirty (`isDirty: true`) for subsequent file saving

#### Scenario: Loading a new project layout
- **WHEN** a newly created project is loaded
- **THEN** the rail defaults to the `true` (collapsed) state unless overridden in the project file

### Requirement: Absence of Project Context

When no project is loaded, the desktop shell MUST enforce a collapsed state. The rail is conceptually tied to project-level phases; thus, without a project, it SHALL NOT expand.

#### Scenario: No active project
- **WHEN** the desktop application has no project loaded
- **THEN** the rail remains fully collapsed and non-expandable to maximize screen real estate for the landing view

### Requirement: Mobile Drawer Separation

The desktop rail interactions SHALL NOT affect mobile/responsive layouts. Mobile navigation MUST continue relying on the hidden `sm` breakpoint and a full drawer overlay invoked via the header burger icon.

#### Scenario: Mobile viewport usage
- **WHEN** viewing the application on a mobile or small viewport
- **THEN** the rail is hidden, and the burger menu triggers an overlay drawer instead of side-by-side rail expansion
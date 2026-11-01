## Purpose

Define the responsive collapsible desktop navigation rail.

## Requirements

### Requirement: Desktop Rail UI

The application shell SHALL use a collapsible rail for desktop navigation instead of a fixed-width sidebar. The rail SHALL toggle between a collapsed width of 60px and an expanded width of 240px.

#### Scenario: Rail in collapsed state

- **WHEN** the rail is collapsed
- **THEN** it displays vertically centered icons, a right-facing chevron `›` at the top, a home icon pinned to the bottom, and no textual labels

#### Scenario: Rail in expanded state

- **WHEN** the rail is expanded
- **THEN** it SHALL display side-by-side icons and labels, a left-facing chevron `‹` toggle at the top without separate "Navigation" text, and a home icon pinned to the bottom with a "Return to home" label
- **AND** the toggle SHALL expose a "Collapse navigation" tooltip and accessible label; when collapsed, both SHALL read "Expand navigation"

### Requirement: UI State Persistence

The rail expansion state SHALL persist within a given project's `uiState` as a boolean (`navbarCollapsed`). This requirement intentionally binds presentation state to the project domain rather than global app settings.

#### Scenario: Toggling the rail inside a project

- **WHEN** a user clicks the chevron toggle while a project is loaded
- **THEN** the project's `navbarCollapsed` boolean is updated in memory and the project is marked as dirty (`isDirty: true`) for subsequent file saving

#### Scenario: Loading a new project layout

- **WHEN** a newly created project is loaded
- **THEN** the rail defaults to the `true` (collapsed) state unless overridden in the project file

### Requirement: Absence of Project Context

When no project is loaded, the shell SHALL not render the project navbar or its expansion control.

#### Scenario: No active project

- **WHEN** the desktop application has no project loaded
- **THEN** the project navbar and its toggle SHALL be absent

### Requirement: Mobile Navbar

The shell SHALL use the `xs` breakpoint for responsive navigation. Below it, the header burger SHALL open or close the same AppShell navbar; its rail toggle SHALL use the project's shared expansion state.

#### Scenario: Mobile viewport usage

- **WHEN** viewing the application on a mobile or small viewport
- **THEN** the burger SHALL toggle the mobile navbar, including its rail expansion control

## Why

<!-- Explain the motivation for this change. What problem does this solve? Why now? -->

## What Changes

<!-- Describe what will change. Be specific about new capabilities, modifications, or removals. -->

## Capabilities

### New Capabilities

<!-- Capabilities being introduced. Use kebab-case for path segments you introduce
     (e.g., user-auth or identity/user-auth) that follow the project's existing
     spec organization. Each creates specs/<capability-path>/spec.md. -->

- `<capability-path>`: <brief description of what this capability covers>

### Modified Capabilities

<!-- Existing capabilities whose REQUIREMENTS are changing (not just implementation).
     Only list here if spec-level behavior changes. Each needs a delta spec file.
     Use the exact existing path under openspec/specs/. Leave empty if no requirement
     changes. A change with no capabilities at all (pure refactor, tooling, docs)
     must set `skip_specs: true` in its .openspec.yaml - openspec validate rejects
     a zero-delta change without that marker. Do not invent a requirement just to
     satisfy validation. -->

- `<existing-capability-path>`: <what requirement is changing>

## Impact

<!-- Affected code, APIs, dependencies, systems -->

## Superseded Systems & Retirement

<!-- What existing functionality, components, or APIs are superseded by this change?
     Declare whether dual-path coexistence is permitted (default: strictly forbidden).
     Every superseded element MUST be scheduled for complete removal in this change.
     If nothing is superseded, explicitly state "None". -->

- **Superseded components / APIs**: <!-- List replaced modules, functions, or IPC commands -->
- **Dual-path coexistence**: Forbidden <!-- Default is strictly forbidden; no permanent adapters -->
- **Target deletion scope**: <!-- State which group/milestone removes superseded code -->

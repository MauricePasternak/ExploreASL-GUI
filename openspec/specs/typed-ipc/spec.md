# typed-ipc Specification

## Purpose

Keep application command contracts authoritative in Rust while providing generated TypeScript inputs, successful results, and structured application errors.

## Requirements

### Requirement: Single generated command contract

Application command registration and TypeScript binding generation SHALL use the same native command collection. Frontend application calls SHALL use generated commands rather than a handwritten command-to-type map or caller-selected `invoke` return types. Official Tauri plugin functions and event subscriptions SHALL retain their existing interfaces.

#### Scenario: Native command contract changes

- **WHEN** a registered command's arguments or exposed result types change
- **THEN** regeneration SHALL reflect the native contract and TypeScript checking SHALL reject incompatible frontend calls

### Requirement: Structured typed application errors

Fallible application commands SHALL expose a discriminated success/error result in generated frontend bindings. Application errors SHALL include string `message` and `details` fields. Existing domain information, including storage categories and import validation issues, SHALL remain structured and available to callers. Error handling SHALL preserve existing save, recovery, and execution safety behavior. Existing command tracing logs some arguments, including project paths and subject/session identifiers.

Both fields SHALL be human-facing: `message` SHALL concisely describe the failed operation; `details` SHALL explain a known cause or useful next steps. When no reliable explanation exists, `details` SHALL be empty rather than invent a cause or expose arbitrary diagnostics. Original developer diagnostics, including error chains and external tool output, SHALL be retained through the existing application logger before human-facing conversion, subject to its existing limits. Internal `anyhow` errors MAY remain; their context chains SHALL NOT automatically become user-facing copy.

#### Scenario: Application command fails

- **WHEN** a command returns an application error
- **THEN** the frontend SHALL receive a typed error result containing its concise message, human-readable explanation if available, and applicable domain fields

#### Scenario: Framework rejects an invocation

- **WHEN** invocation rejects with a framework string, a JavaScript error, or a malformed application error
- **THEN** the generated runtime SHALL throw a JavaScript error rather than represent that value as the command's declared application error type

### Requirement: Persistent error notifications

User-facing error notifications SHALL use a shared presenter with concise, operation-specific copy. Error notifications SHALL remain until explicitly dismissed or the application exits, including across navigation. Success, information, warning, and progress notification lifetimes SHALL remain unchanged. Repeated failures for the same operation and affected project or profile SHALL update the existing notification with the latest content, including when it is queued or a previous notification was dismissed. The five-visible-notifications-per-position limit SHALL remain; newest errors SHALL receive priority and older notifications SHALL remain in the existing queue rather than be discarded.

#### Scenario: A repeated failure occurs

- **WHEN** the same operation fails again for the same project or profile
- **THEN** its existing notification SHALL update instead of creating a duplicate and SHALL receive newest-error priority

#### Scenario: Visible notifications are full

- **WHEN** a new error occurs with five notifications already visible at its position
- **THEN** the new error SHALL become visible and displaced notifications SHALL remain queued until a visible notification is dismissed

### Requirement: Human-readable error details

An error notification SHALL offer a "See details" action only when additional nonempty explanation exists. The action SHALL open a root-mounted modal displaying the summary and explanation as readable, selectable plain text with preserved line breaks and scrolling. Terminal escape sequences SHALL be removed; content SHALL NOT be interpreted as HTML or Markdown. The modal SHALL support keyboard dismissal and copying only its human-facing summary and explanation. Clipboard failures SHALL leave the text available for manual copying. Opening or closing the modal SHALL NOT dismiss its notification. Neither notifications nor modal state SHALL be persisted across application restarts.

#### Scenario: Framework failure has no human explanation

- **WHEN** a framework exception or arbitrary string has no curated explanation
- **THEN** the notification SHALL show caller-supplied operation-specific copy without displaying raw exception messages or stack traces and SHALL omit the details action

#### Scenario: Details are viewed and copied

- **WHEN** the user opens and copies error details
- **THEN** the modal SHALL show and copy only readable summary and explanation, without hidden developer diagnostics, and the notification SHALL remain available after the modal closes

### Requirement: Explicit reproducible binding generation

Bindings SHALL be generated through an explicit developer command and checked for staleness before frontend type checking. Binding checks SHALL NOT rewrite tracked files. Native application startup and backend tests SHALL NOT regenerate source bindings. Generated types SHALL NOT replace runtime validation of external data or domain invariants.

#### Scenario: Checked-in bindings are stale

- **WHEN** the binding check finds output that differs from the checked-in bindings
- **THEN** checking SHALL fail with regeneration guidance without modifying those bindings

## Description

Please include a summary of the changes and the motivation/context for this pull request.

Fixes / references: # (issue number or spec path)

## Type of Change

Please delete options that are not relevant.

- [ ] Bug fix (non-breaking change which fixes an issue)
- [ ] New feature (non-breaking change which adds functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality to not work as expected)
- [ ] Documentation update
- [ ] Refactoring / Code maintenance

## Quality Checklist

Before submitting this PR, please check that you have completed the following:

- [ ] **Formatting**: Code is formatted. Run `pnpm format` (and `pnpm format:rust` if Rust/Tauri changes were made).
- [ ] **Linting**: No linting issues. Run `pnpm lint`.
- [ ] **Type-checking**: No TypeScript compiler errors. Run `pnpm typecheck`.
- [ ] **Tests**: All tests pass. Run `pnpm test` (and `pnpm test:rust` if Rust/Tauri changes were made).
- [ ] **Component IDs**: Added `data-testid` attributes to any new/modified interactive UI elements.
- [ ] **OS Compatibility**: Avoided hardcoded paths (e.g. `/tmp/`). Used Tauri/Rust filesystem APIs.
- [ ] **Commit Messages**: Commits follow the [Conventional Commits](https://www.conventionalcommits.org/) specification (e.g. `feat: ...`, `fix: ...`).
- [ ] **PR Labels**: Applied appropriate labels (e.g., `bug`, `enhancement`, `documentation`) to allow automated release notes to classify these changes correctly.

## Screenshots / Media

If applicable, add screenshots, GIFs, or screen recordings to visually demonstrate the change.

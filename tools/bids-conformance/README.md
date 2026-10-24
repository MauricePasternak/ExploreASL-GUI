# Development-only BIDS conformance

Use Deno **2.6.6** and official `@bids/validator` **3.0.2**. Dependencies and
bundled schema are frozen in generated `deno.lock`; no app manifest or release
bundle includes this tooling. Unset `BIDS_SCHEMA` before running.

From repository root, download dependencies separately (network allowed):

```sh
deno install --config tools/bids-conformance/deno.json --frozen --entrypoint tools/bids-conformance/check.ts
```

Then run the actual check (network, writes and subprocesses denied):

```sh
deno task --config tools/bids-conformance/deno.json check
```

The check uses cached dependencies and the bundled schema only. It prints the
validator, BIDS and schema versions plus every issue. Errors fail; warnings stay
visible and nonfatal. No NIfTI/header checks or error categories are disabled.
Native tests consume the same fixture and assert scientific values directly;
the validator is not an effective-metadata oracle or an engine compatibility test.

To update pins, review upstream public API/schema compatibility, change this
directory's imports and CI Deno pin together, regenerate the lock with the selected
Deno version using the setup command without `--frozen`, then repeat offline
validation and native BIDS tests on Linux, macOS and Windows. Never hand-edit lock
resolutions or change app/release dependencies for this check.

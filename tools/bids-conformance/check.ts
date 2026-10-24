import { schema } from "@bids/schema";
import { readFileTree } from "@bids/validator/files/deno";
import { detectErrors, getVersion, validate } from "@bids/validator/validate";
import { fileURLToPath } from "node:url";

if (Deno.env.get("BIDS_SCHEMA") !== undefined) {
  throw new Error("Unset BIDS_SCHEMA: this check requires the locked bundled schema.");
}
const datasetPath = fileURLToPath(
  new URL("../../test/fixtures/bids-inheritance/", import.meta.url),
);
console.log(
  JSON.stringify({
    validator: await getVersion(),
    bids: schema.bids_version,
    schema: schema.schema_version,
  }),
);
const result = await validate(await readFileTree(datasetPath), {
  datasetPath,
  debug: "ERROR",
  datasetTypes: [],
  blacklistModalities: [],
});
if (result.summary.schemaVersion !== schema.schema_version) {
  throw new Error("Validator and reported bundled schema versions differ.");
}
console.log(JSON.stringify({ issues: result.issues.issues, summary: result.summary }, null, 2));
if (detectErrors(result)) Deno.exit(1);

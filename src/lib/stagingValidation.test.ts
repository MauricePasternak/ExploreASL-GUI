import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  componentValidationMessage,
  portableCollisionIssues,
  portableKey,
  sortStagingIssues,
  suggestPortableComponent,
} from "./stagingValidation";

interface Vectors {
  components: Array<{ value: string; valid: boolean }>;
  portableKeys: Array<{ value: string; key: string }>;
}

const vectors = JSON.parse(
  readFileSync(resolve(process.cwd(), "test/fixtures/staging_identifier_vectors.json"), "utf8"),
) as Vectors;

describe("stagingValidation", () => {
  it("uses shared portable component and key vectors", () => {
    for (const vector of vectors.components) {
      expect(componentValidationMessage(vector.value) === undefined, vector.value).toBe(
        vector.valid,
      );
    }
    for (const vector of vectors.portableKeys) {
      expect(portableKey(vector.value)).toBe(vector.key);
    }
  });

  it("reports both portable collision participants in deterministic order", () => {
    const issues = portableCollisionIssues(
      [
        { value: "Straße", entryIndex: 2 },
        { value: "STRASSE", entryIndex: 1 },
      ],
      "subject",
    );
    expect(issues).toMatchObject([
      { entryIndex: 1, conflictingEntryIndex: 2 },
      { entryIndex: 2, conflictingEntryIndex: 1 },
    ]);
  });

  it("sorts issues without mutating input and suggests only safe replacements", () => {
    const input = [
      { code: "Z", field: "run" as const, entryIndex: 2, message: "z" },
      { code: "A", field: "subject" as const, entryIndex: 1, message: "a" },
    ];
    expect(sortStagingIssues(input).map((issue) => issue.code)).toEqual(["A", "Z"]);
    expect(input.map((issue) => issue.code)).toEqual(["Z", "A"]);
    expect(suggestPortableComponent("bad/name.")).toBe("bad-name");
    expect(suggestPortableComponent("CON")).toBeUndefined();
  });
});

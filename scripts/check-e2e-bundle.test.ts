import { describe, expect, it } from "vitest";

import { FORBIDDEN_E2E_MARKERS, findForbiddenE2EMarkers } from "./check-e2e-bundle.mjs";

describe("E2E production bundle sentinel", () => {
  it("accepts JavaScript without E2E bridge markers", () => {
    expect(findForbiddenE2EMarkers("const production = true;")).toEqual([]);
  });

  it("reports every forbidden E2E bridge marker", () => {
    const source = FORBIDDEN_E2E_MARKERS.join("\n");

    expect(findForbiddenE2EMarkers(source)).toEqual(FORBIDDEN_E2E_MARKERS);
  });
});

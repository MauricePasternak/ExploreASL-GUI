import { describe, expect, it } from "vitest";

import { stripEmptyBidsParams } from "./metadataFieldHints";

describe("stripEmptyBidsParams", () => {
  it("removes undefined, empty strings, and empty arrays", () => {
    const result = stripEmptyBidsParams({
      ArterialSpinLabelingType: "PCASL",
      EchoTime: undefined,
      PostLabelingDelay: [],
      Manufacturer: "Siemens",
    });

    expect(result).toEqual({
      ArterialSpinLabelingType: "PCASL",
      Manufacturer: "Siemens",
    });
  });

  it("keeps explicit false booleans", () => {
    const result = stripEmptyBidsParams({
      BackgroundSuppression: false,
      M0Type: "Separate",
    });

    expect(result).toEqual({
      BackgroundSuppression: false,
      M0Type: "Separate",
    });
  });
});

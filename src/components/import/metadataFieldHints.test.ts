import { describe, expect, it } from "vitest";

import {
  METADATA_FIELD_HINT_TEXT,
  stripEmptyBidsParams,
} from "./metadataFieldHints";

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

describe("METADATA_FIELD_HINT_TEXT", () => {
  it("documents DICOM-likely fields as override-only", () => {
    expect(METADATA_FIELD_HINT_TEXT.dicomLikely).toMatch(/DICOM/i);
    expect(METADATA_FIELD_HINT_TEXT.dicomLikely).toMatch(/omitted/i);
  });
});

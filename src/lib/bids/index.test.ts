import { describe, it, expect } from "vitest";
import * as bids from "./index";

describe("bids module index", () => {
  it("re-exports path utilities", () => {
    expect(typeof bids.isBidsFilename).toBe("function");
    expect(typeof bids.parseBidsEntities).toBe("function");
    expect(typeof bids.isAslSuffix).toBe("function");
    expect(typeof bids.isM0Suffix).toBe("function");
    expect(typeof bids.isSubjectDir).toBe("function");
    expect(typeof bids.isSessionDir).toBe("function");
  });

  it("re-exports validation utilities", () => {
    expect(typeof bids.isBidsProject).toBe("function");
    expect(typeof bids.ensureBidsIgnore).toBe("function");
    expect(bids.BIDS_IGNORE_ENTRIES).toBeDefined();
  });

  it("re-exports sidecar utilities", () => {
    expect(typeof bids.summarizeAslContext).toBe("function");
    expect(typeof bids.parseAslContext).toBe("function");
    expect(typeof bids.validateBidsAslParams).toBe("function");
    expect(typeof bids.extractFingerprint).toBe("function");
    expect(typeof bids.deriveInjectedFields).toBe("function");
  });

  it("re-exports schema", () => {
    expect(bids.BidsAslMetadataSchema).toBeDefined();
    expect(bids.BidsAslMetadataBaseSchema).toBeDefined();
  });

  it("re-exports normalize utilities", () => {
    expect(typeof bids.normalizePulseSequenceType).toBe("function");
    expect(typeof bids.normalizeManufacturer).toBe("function");
  });
});

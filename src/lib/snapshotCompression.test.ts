import { describe, expect, it, vi } from "vitest";

import type { ImportSnapshot } from "../schemas/importSchemas";
import { compressSnapshot, decompressSnapshot } from "./snapshotCompression";

const BASE_SNAPSHOT: ImportSnapshot = {
  sourceDataPath: "/scan/data",
  pathPatterns: [],
  tokenizerConfigs: {},
  bMatchDirectories: true,
  modalityAliases: [],
  sessionAliases: [],
  runAliases: [],
  subjectRenames: [],
  metadataGroups: [],
  subjectRows: [],
};

function makeSyntheticSnapshot(subjectCount: number): ImportSnapshot {
  const subjectRows = Array.from({ length: subjectCount }, (_, i) => ({
    id: `SUB${String(i).padStart(4, "0")}/01`,
    subject: `SUB${String(i).padStart(4, "0")}`,
    session: "01",
    groupId: "global-defaults",
  }));
  return { ...BASE_SNAPSHOT, subjectRows };
}

describe("snapshotCompression round-trip", () => {
  it("compress → decompress returns an equivalent object", () => {
    const snapshot: ImportSnapshot = {
      ...BASE_SNAPSHOT,
      subjectRows: [
        { id: "BAR/01", subject: "BAR", session: "01", groupId: "g1" },
        { id: "BAZ/01", subject: "BAZ", session: "01", groupId: "g2" },
      ],
      metadataGroups: [
        {
          id: "g1",
          label: "G1",
          bidsParams: { ArterialSpinLabelingType: "PCASL" },
        },
        {
          id: "g2",
          label: "G2",
          bidsParams: { ArterialSpinLabelingType: "CASL" },
        },
      ],
    };
    const encoded = compressSnapshot(snapshot);
    expect(typeof encoded).toBe("string");
    expect(encoded.length).toBeGreaterThan(0);
    const decoded = decompressSnapshot(encoded);
    expect(decoded).toEqual(snapshot);
  });

  it("handles 10000-subject payload without corruption", () => {
    const snapshot = makeSyntheticSnapshot(10_000);
    const encoded = compressSnapshot(snapshot);
    const decoded = decompressSnapshot(encoded);
    expect(decoded).toEqual(snapshot);
    expect(decoded?.subjectRows).toHaveLength(10_000);
    expect(decoded?.subjectRows[9999].subject).toBe("SUB9999");
  });

  it("compress output is significantly smaller than raw JSON for large payloads", () => {
    const snapshot = makeSyntheticSnapshot(10_000);
    const rawJson = JSON.stringify(snapshot);
    const encoded = compressSnapshot(snapshot);
    // gzip+base64 should reduce by at least 80% on repetitive row data
    expect(encoded.length).toBeLessThan(rawJson.length * 0.2);
  });
});

describe("snapshotCompression error handling", () => {
  it("returns null for corrupted base64", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = decompressSnapshot("!!!not-valid-base64!!!");
    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("returns null for valid base64 but invalid gzip payload", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const invalidGzip = btoa("this is not gzip data");
    const result = decompressSnapshot(invalidGzip);
    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("returns null for valid gzip but missing required snapshot keys", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    // Compress a payload that's valid JSON but not an ImportSnapshot
    const encoded = compressSnapshot({ sourceDataPath: "/x" } as unknown as ImportSnapshot);
    const result = decompressSnapshot(encoded);
    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

import { describe, expect, it } from "vitest";
import { gzipSync, strToU8 } from "fflate";

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

function gzipBase64(value: string) {
  const bytes = gzipSync(strToU8(value), { level: 9 });
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
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

  it("produces identical bytes for equivalent records with different key insertion order", () => {
    const first = {
      ...BASE_SNAPSHOT,
      tokenizerConfigs: { beta: [], alpha: [] },
    };
    const second = {
      ...BASE_SNAPSHOT,
      tokenizerConfigs: { alpha: [], beta: [] },
    };

    expect(compressSnapshot(first)).toBe(compressSnapshot(second));
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
  it("rejects corrupted base64", () => {
    expect(() => decompressSnapshot("!!!not-valid-base64!!!")).toThrow();
  });

  it("rejects valid base64 but invalid gzip payload", () => {
    const invalidGzip = btoa("this is not gzip data");
    expect(() => decompressSnapshot(invalidGzip)).toThrow();
  });

  it("rejects valid gzip with invalid JSON", () => {
    expect(() => decompressSnapshot(gzipBase64("not JSON"))).toThrow();
  });

  it("rejects valid gzip JSON with an invalid snapshot shape", () => {
    expect(() => decompressSnapshot(gzipBase64('{"sourceDataPath":"/x"}'))).toThrow();
  });
});

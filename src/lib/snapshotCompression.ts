import { gzipSync, gunzipSync, strFromU8, strToU8 } from "fflate";

import { ImportSnapshotSchema, type ImportSnapshot } from "../schemas/importSchemas";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => (entry === undefined ? null : canonicalize(entry)));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .flatMap((key) => {
          const entry = (value as Record<string, unknown>)[key];
          return entry === undefined ? [] : [[key, canonicalize(entry)]];
        }),
    );
  }
  return value;
}

/** JSON encoding with sorted object keys for reproducible compressed snapshots. */
export function stableJsonStringify(value: unknown, space?: number): string {
  return JSON.stringify(canonicalize(value), null, space);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function compressSnapshot(snapshot: ImportSnapshot): string {
  const json = stableJsonStringify(ImportSnapshotSchema.parse(snapshot));
  const compressed = gzipSync(strToU8(json), { level: 9 });
  return bytesToBase64(compressed);
}

export function decompressSnapshot(encoded: string): ImportSnapshot {
  const bytes = base64ToBytes(encoded);
  const decompressed = gunzipSync(bytes);
  return ImportSnapshotSchema.parse(JSON.parse(strFromU8(decompressed)));
}

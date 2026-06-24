import { gzipSync, gunzipSync, strFromU8, strToU8 } from "fflate";

import type { ImportSnapshot } from "../schemas/importSchemas";

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
  const json = JSON.stringify(snapshot);
  const compressed = gzipSync(strToU8(json), { level: 9 });
  return bytesToBase64(compressed);
}

export function decompressSnapshot(encoded: string): ImportSnapshot | null {
  try {
    const bytes = base64ToBytes(encoded);
    const decompressed = gunzipSync(bytes);
    const json = strFromU8(decompressed);
    const parsed = JSON.parse(json) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      "sourceDataPath" in parsed &&
      "subjectRows" in parsed
    ) {
      return parsed as ImportSnapshot;
    }
    console.warn("[snapshotCompression] decompressed payload missing required keys");
    return null;
  } catch (err) {
    console.warn("[snapshotCompression] decompress failed:", err);
    return null;
  }
}

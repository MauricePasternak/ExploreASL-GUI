import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const FORBIDDEN_E2E_MARKERS = [
  "manifest-disagreements",
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "Unknown E2E scenario",
  "__E2E__",
];

export function findForbiddenE2EMarkers(source) {
  return FORBIDDEN_E2E_MARKERS.filter((marker) => source.includes(marker));
}

async function collectJavaScriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) return collectJavaScriptFiles(path);
      return entry.isFile() && /\.[cm]?js$/.test(entry.name) ? [path] : [];
    }),
  );
  return files.flat();
}

export async function findForbiddenE2EMarkersInBundle(directory) {
  const files = await collectJavaScriptFiles(directory);
  if (files.length === 0) {
    throw new Error(`No JavaScript bundle files found in ${directory}`);
  }

  const matches = new Set();
  for (const file of files) {
    for (const marker of findForbiddenE2EMarkers(await readFile(file, "utf8"))) {
      matches.add(marker);
    }
  }
  return [...matches];
}

async function main() {
  const directory = resolve(process.argv[2] ?? "dist");
  const markers = await findForbiddenE2EMarkersInBundle(directory);
  if (markers.length > 0) {
    console.error(`Forbidden E2E markers found in production bundle: ${markers.join(", ")}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Production bundle contains no forbidden E2E markers: ${directory}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}

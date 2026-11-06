import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";

export const DATASET_COMMIT = "8e9c27bfceeedbd9ab814a08272d5ed1782f221d";
export const SUBJECTS = ["170", "172"] as const;
export const SESSION = "hormoneabsent";
export const ANALYSIS_TIMEOUT = 90 * 60_000;

// OpenNeuro ds003151 2.0.1 (CC0). Images verified against pinned git-annex MD5E keys;
// SHA256 hashes cover exact downloaded bytes. No acquisition fields are rewritten.
export const DATASET_FILES: [string, number, string][] = [
  [
    "dataset_description.json",
    2077,
    "2f5a8f4e5bbb2009bc97ac659a3b4dec2802f16685ace05907c53542c672fb6c",
  ],
  ["README", 1245, "b8ca87ab9d409186fa99a9cccda6d9ed59c38e3f4b65621df0c650957ef65420"],
  [
    "sub-170/ses-hormoneabsent/anat/sub-170_ses-hormoneabsent_T1w.nii.gz",
    7850405,
    "da2fa6d6034b7aad7285b6c4128d4b0c326163eb117556a3a0dc463c4e0a1c93",
  ],
  [
    "sub-170/ses-hormoneabsent/perf/sub-170_ses-hormoneabsent_asl.json",
    3806,
    "83e0dd2bf97ee972602f3c8a5b6e1593b569fcbaa16742b4c145c03722b56147",
  ],
  [
    "sub-170/ses-hormoneabsent/perf/sub-170_ses-hormoneabsent_asl.nii.gz",
    7982668,
    "f11f10db801612986239b491f8de3a39f6c42b5d4f5231466fcd08bfa8e89437",
  ],
  [
    "sub-170/ses-hormoneabsent/perf/sub-170_ses-hormoneabsent_aslcontext.tsv",
    723,
    "1d8333f23cf6accf072a39e6a6ece526a3cf50a97b8e68325c3b37c5ac740af2",
  ],
  [
    "sub-172/ses-hormoneabsent/anat/sub-172_ses-hormoneabsent_T1w.nii.gz",
    8548490,
    "2c85f404958434b3828d378bf9bfd7ee645727bb719d45ce48d66a060d5a8aa9",
  ],
  [
    "sub-172/ses-hormoneabsent/perf/sub-172_ses-hormoneabsent_asl.json",
    3810,
    "289a48ca09a9214016054c9157ab5ee4dec99c0f586539506ecba8a45f644744",
  ],
  [
    "sub-172/ses-hormoneabsent/perf/sub-172_ses-hormoneabsent_asl.nii.gz",
    8281902,
    "4e4273f1374ef5ef558ec27c91be81816e933a5085db3133a30b28821aa72b27",
  ],
  [
    "sub-172/ses-hormoneabsent/perf/sub-172_ses-hormoneabsent_aslcontext.tsv",
    723,
    "1d8333f23cf6accf072a39e6a6ece526a3cf50a97b8e68325c3b37c5ac740af2",
  ],
];

export async function verifyFile(file: string, sha256: string, bytes?: number): Promise<void> {
  assert.match(sha256, /^[a-f0-9]{64}$/i, "Expected an explicit SHA256 checksum");
  const info = await stat(file);
  assert.ok(info.isFile(), `Not a file: ${file}`);
  if (bytes !== undefined) assert.equal(info.size, bytes, `Size mismatch: ${file}`);
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  assert.equal(hash.digest("hex"), sha256.toLowerCase(), `SHA256 mismatch: ${file}`);
}

export async function prepareAnalysisProject(root: string, localDataset?: string): Promise<void> {
  // Exclusive creation: never reuse an already-processed project or delete someone else's data.
  await mkdir(root);
  for (const [relative, bytes, hash] of DATASET_FILES) {
    const destination = path.join(root, relative);
    await mkdir(path.dirname(destination), { recursive: true });
    const local = localDataset && path.join(localDataset, relative);
    if (
      local &&
      (await access(local).then(
        () => true,
        () => false,
      ))
    ) {
      await verifyFile(local, hash, bytes);
      await copyFile(local, destination);
    } else {
      const url = relative.endsWith(".nii.gz")
        ? `https://s3.amazonaws.com/openneuro.org/ds003151/${relative}`
        : `https://raw.githubusercontent.com/OpenNeuroDatasets/ds003151/${DATASET_COMMIT}/${relative}`;
      const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
      if (!response.ok) throw new Error(`Fixture download failed (${response.status}): ${url}`);
      await writeFile(destination, Buffer.from(await response.arrayBuffer()), { flag: "wx" });
    }
    await verifyFile(destination, hash, bytes);
  }
}

export async function assertFreshFile(file: string, startedAt: number): Promise<Buffer> {
  const info = await stat(file);
  assert.ok(info.isFile() && info.mtimeMs >= startedAt - 2_000, `Missing/stale output: ${file}`);
  return readFile(file);
}

/** Read generated NIfTI-1 data, not a scientific acceptance test or numerical golden. */
export function assertReadableNifti(bytes: Buffer): void {
  const data = bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes;
  assert.ok(data.length >= 352, "Truncated NIfTI header");
  const little = data.readInt32LE(0) === 348;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  assert.equal(view.getInt32(0, little), 348, "Expected NIfTI-1");
  assert.equal(data.toString("ascii", 344, 347), "n+1");
  const rank = view.getInt16(40, little);
  assert.ok(rank >= 3 && rank <= 7);
  let voxels = 1;
  for (let i = 1; i <= rank; i++) {
    const dimension = view.getInt16(40 + i * 2, little);
    assert.ok(dimension > 0);
    voxels *= dimension;
  }
  const datatype = view.getInt16(70, little);
  const readers: Record<number, [number, (offset: number) => number]> = {
    2: [1, (o) => view.getUint8(o)],
    4: [2, (o) => view.getInt16(o, little)],
    8: [4, (o) => view.getInt32(o, little)],
    16: [4, (o) => view.getFloat32(o, little)],
    64: [8, (o) => view.getFloat64(o, little)],
    512: [2, (o) => view.getUint16(o, little)],
  };
  assert.ok(readers[datatype], `Unsupported output datatype: ${datatype}`);
  const [width, read] = readers[datatype];
  const offset = view.getFloat32(108, little);
  assert.ok(
    Number.isInteger(offset) && offset >= 352 && offset + voxels * width <= data.length,
    "Truncated NIfTI voxel data",
  );
  let nonzero = false;
  for (let i = 0; i < voxels; i++) {
    const value = read(offset + i * width);
    if (Number.isFinite(value) && value !== 0) nonzero = true;
  }
  assert.ok(nonzero, "Image contains no finite nonzero voxels");
}

export function isolatedAnalysisEnvironment(
  base: NodeJS.ProcessEnv,
  root: string,
): NodeJS.ProcessEnv {
  const home = path.join(root, "home");
  const cache = path.join(home, ".mcrCache9.7");
  const temp = path.join(home, "tmp");
  return {
    ...base,
    HOME: home,
    XDG_CONFIG_HOME: path.join(root, "config"),
    XDG_CACHE_HOME: path.join(root, "cache"),
    XDG_DATA_HOME: path.join(root, "data"),
    XDG_STATE_HOME: path.join(root, "state"),
    XDG_RUNTIME_DIR: path.join(root, "runtime"),
    TMPDIR: temp,
    TMP: temp,
    TEMP: temp,
    APPTAINER_CONFIGDIR: path.join(home, ".apptainer"),
    // Apptainer otherwise uses the passwd home, not the test process's HOME override.
    APPTAINER_HOME: `${home}:${home}`,
    APPTAINER_CACHEDIR: path.join(root, "apptainer-cache"),
    APPTAINER_TMPDIR: temp,
    APPTAINERENV_TMPDIR: temp,
    MCR_CACHE_ROOT: cache,
    APPTAINERENV_MCR_CACHE_ROOT: cache,
  };
}

export async function stopAndCloseAnalysisProject(
  stop: () => Promise<void>,
  close: () => Promise<void>,
): Promise<void> {
  const errors: unknown[] = [];
  try {
    await stop();
  } catch (error) {
    errors.push(error);
  }
  try {
    await close();
  } catch (error) {
    errors.push(error);
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) {
    throw new AggregateError(errors, "Analysis Stop and GUI project closure both failed");
  }
}

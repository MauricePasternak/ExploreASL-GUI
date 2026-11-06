import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { gzipSync } from "node:zlib";
import {
  DATASET_FILES,
  SESSION,
  SUBJECTS,
  assertReadableNifti,
  isolatedAnalysisEnvironment,
  prepareAnalysisProject,
  stopAndCloseAnalysisProject,
  verifyFile,
} from "./support/full-analysis-fixture";

test("fixture allowlist contains only two sessions, T1w/ASL with included M0 and exact metadata", () => {
  const names = DATASET_FILES.map(([name]) => name);
  assert.equal(names.length, 10);
  assert.equal(names.filter((name) => name.endsWith(".nii.gz")).length, 4);
  assert.equal(new Set(names).size, 10);
  for (const subject of SUBJECTS) {
    const prefix = `sub-${subject}/ses-${SESSION}`;
    assert.ok(names.includes(`${prefix}/anat/sub-${subject}_ses-${SESSION}_T1w.nii.gz`));
    for (const suffix of ["asl.json", "asl.nii.gz", "aslcontext.tsv"]) {
      assert.ok(names.includes(`${prefix}/perf/sub-${subject}_ses-${SESSION}_${suffix}`));
    }
  }
  for (const [name, size, hash] of DATASET_FILES) {
    assert.ok(!name.includes("..") && !path.isAbsolute(name));
    assert.ok(size > 0);
    assert.match(hash, /^[a-f0-9]{64}$/);
    assert.doesNotMatch(name, /derivatives|project\.easl|status|func|dwi|m0scan/);
  }
});

test("analysis environment replaces personal settings, temp, runtime and MCR paths before spawn", () => {
  const root = path.join(tmpdir(), "isolated-test");
  const env = isolatedAnalysisEnvironment(
    { HOME: "/personal", XDG_CONFIG_HOME: "/personal/config", KEEP: "yes" },
    root,
  );
  for (const key of [
    "HOME",
    "XDG_CONFIG_HOME",
    "XDG_CACHE_HOME",
    "XDG_DATA_HOME",
    "XDG_STATE_HOME",
    "XDG_RUNTIME_DIR",
    "TMPDIR",
    "APPTAINER_CACHEDIR",
    "APPTAINER_CONFIGDIR",
    "APPTAINER_HOME",
    "APPTAINERENV_TMPDIR",
    "MCR_CACHE_ROOT",
    "APPTAINERENV_MCR_CACHE_ROOT",
  ]) {
    assert.ok(env[key]!.startsWith(root + path.sep), key);
  }
  assert.equal(env.KEEP, "yes");
  assert.equal(env.APPTAINER_HOME, `${env.HOME}:${env.HOME}`);
  assert.equal(env.APPTAINERENV_TMPDIR, env.TMPDIR);
});

test("checksum/size failures reject rather than use modified local input", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "easl-checksum-"));
  try {
    const file = path.join(root, "input");
    await writeFile(file, "exact");
    const hash = createHash("sha256").update("exact").digest("hex");
    await verifyFile(file, hash, 5);
    await assert.rejects(verifyFile(file, "0".repeat(64), 5), /SHA256 mismatch/);
    await assert.rejects(verifyFile(file, hash, 6), /Size mismatch/);
    assert.equal(await readFile(file, "utf8"), "exact");
  } finally {
    await rm(root, { recursive: true });
  }
});

test("fixture setup rejects an existing project before downloads or writes", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "easl-existing-"));
  try {
    const projectFile = path.join(root, "project.easl");
    await writeFile(projectFile, "preserve");
    await assert.rejects(prepareAnalysisProject(root), { code: "EEXIST" });
    assert.equal(await readFile(projectFile, "utf8"), "preserve");
  } finally {
    await rm(root, { recursive: true });
  }
});

test("readability check rejects truncated/empty images and reads gzip voxels", () => {
  const image = Buffer.alloc(384);
  image.writeInt32LE(348);
  image.writeInt16LE(3, 40);
  for (const offset of [42, 44, 46]) image.writeInt16LE(2, offset);
  image.writeInt16LE(16, 70);
  image.writeFloatLE(352, 108);
  image.write("n+1\0", 344);
  assert.throws(() => assertReadableNifti(image), /no finite nonzero/);
  image.writeFloatLE(42, 352);
  assertReadableNifti(gzipSync(image));
  assert.throws(() => assertReadableNifti(image.subarray(0, 360)), /Truncated NIfTI voxel/);
});

test("Stop failure still attempts GUI project closure and preserves the original error", async () => {
  const calls: string[] = [];
  const stopError = new Error("Stop confirmation rejected");
  await assert.rejects(
    stopAndCloseAnalysisProject(
      async () => {
        calls.push("stop");
        throw stopError;
      },
      async () => {
        calls.push("close");
      },
    ),
    (error) => error === stopError,
  );
  assert.deepEqual(calls, ["stop", "close"]);
});

test("Stop and GUI closure failures retain both original errors", async () => {
  const stopError = new Error("Stop settlement wait rejected");
  const closeError = new Error("GUI project closure rejected");
  await assert.rejects(
    stopAndCloseAnalysisProject(
      async () => {
        throw stopError;
      },
      async () => {
        throw closeError;
      },
    ),
    (error) => {
      assert.ok(error instanceof AggregateError);
      assert.equal(error.errors[0], stopError);
      assert.equal(error.errors[1], closeError);
      assert.equal(error.errors.length, 2);
      return true;
    },
  );
});

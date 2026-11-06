import { browser } from "@wdio/globals";
import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import {
  ANALYSIS_TIMEOUT,
  SESSION,
  SUBJECTS,
  assertFreshFile,
  assertReadableNifti,
  stopAndCloseAnalysisProject,
} from "../support/full-analysis-fixture";

const project = process.env.E2E_ANALYSIS_PROJECT!;
const output = path.join(project, "derivatives/ExploreASL");
const byId = (id: string) => browser.$(`[data-testid="${id}"]`);

async function click(id: string, scope?: WebdriverIO.Element): Promise<void> {
  const element = scope ? scope.$(`[data-testid="${id}"]`) : byId(id);
  await element.waitForDisplayed({ timeout: 30_000 });
  await element.scrollIntoView({ block: "center" });
  await element.waitForStable({ timeout: 30_000 });
  await element.waitForClickable({ timeout: 30_000 });
  await element.click();
}

async function select(id: string, value: string): Promise<void> {
  await click(id);
  await click(`${id}-option-${value}`);
}

async function runAndWait(expectedRunCount: number, expectedTargets: number): Promise<number> {
  const started = Date.now();
  await click("start-btn");
  await byId("processing-reserved-request").waitForDisplayed({ timeout: 60_000 });
  const history = path.join(project, "derivatives/ExploreASL_GUI/processing/history/requests");
  let terminalFailure: unknown;
  // Read-only evidence supplements GUI completion: rows alone cannot prove worker exit success.
  await browser.waitUntil(
    async () => {
      const current = await readFile(
        path.join(project, "derivatives/ExploreASL_GUI/processing/current.json"),
        "utf8",
      ).then(
        (text) => JSON.parse(text),
        () => null,
      );
      if (current && ["failed", "cancelled", "interrupted"].includes(current.lifecycle)) {
        terminalFailure = current;
        return true;
      }
      const files = await readdir(history).catch(() => []);
      if (files.length < expectedRunCount) return false;
      const records = await Promise.all(
        files.map(async (file) => JSON.parse(await readFile(path.join(history, file), "utf8"))),
      );
      const invalid = records.find(
        (record) =>
          record.outcome !== "completed" ||
          !record.acknowledged ||
          record.summary.failedWorkerCount !== 0,
      );
      if (
        invalid ||
        files.length !== expectedRunCount ||
        !records.some((record) => record.summary.expectedTargetCount === expectedTargets)
      ) {
        terminalFailure = records;
        return true;
      }
      return (await byId("start-btn").isExisting()) && (await byId("start-btn").isEnabled());
    },
    {
      timeout: ANALYSIS_TIMEOUT,
      interval: 2_000,
      timeoutMsg: "Real analysis did not reach successful settled completion",
    },
  );
  assert.equal(
    terminalFailure,
    undefined,
    `Native analysis failed: ${JSON.stringify(terminalFailure)}`,
  );
  return started;
}

describe("Real ds003151 analysis (opt-in)", () => {
  before(async () => {
    await browser.setWindowSize(1440, 1000);
  });

  after(async () => {
    // Stop via the product's exact-run cancellation, then close the project before driver teardown.
    // Retain all bytes even when cancellation or WebDriver itself fails; never delete active work.
    await stopAndCloseAnalysisProject(
      async () => {
        if ((await byId("stop-btn").isExisting()) && (await byId("stop-btn").isEnabled())) {
          await click("stop-btn");
          await click("stop-confirm-btn");
          await byId("pipeline-config").waitForDisplayed({ timeout: 60_000 });
        }
      },
      async () => {
        if (await byId("layout-nav-home").isExisting()) {
          await click("layout-nav-home");
          if (await byId("layout-leave-modal-abort-btn").isExisting()) {
            await click("layout-leave-modal-abort-btn");
          }
          await byId("landing-hero-title").waitForDisplayed({ timeout: 60_000 });
        }
      },
    );
  });

  it("configures Apptainer, creates BIDS project, runs Structural/ASL then Population", async () => {
    assert.ok(project && process.env.E2E_SIF_PATH, "Isolated runner inputs missing");
    for (const absent of ["project.easl", "derivatives", ".easl_staging"]) {
      assert.equal(
        await access(path.join(project, absent)).then(
          () => true,
          () => false,
        ),
        false,
      );
    }
    // No bridge reset/seed, direct IPC or state injection anywhere in this workflow.
    await click("welcome-open-settings-btn");
    await click("profile-manager-add-btn");
    await select("profile-form-type", "apptainer");
    await byId("profile-form-sif-path").setValue(process.env.E2E_SIF_PATH!);
    await byId("profile-form-apptainer-path").setValue(
      process.env.E2E_APPTAINER_PATH ?? "apptainer",
    );
    await byId("profile-form-label").setValue("ds003151 real analysis");
    await click("profile-form-save-btn");
    await browser.$('[data-testid^="profile-valid-"]').waitForExist({ timeout: 30_000 });
    await click("settings-save-close-btn");

    await click("landing-new-project-more");
    await click("landing-new-project-path");
    await byId("landing-new-project-path-input").setValue(project);
    await click("landing-new-project-path-confirm");
    await click("bids-detection-dialog-skip-radio");
    await byId("bids-setup-plan").waitForDisplayed();
    await click("bids-setup-details-toggle");
    assert.ok((await byId("bids-setup-project-summary").getText()).includes("bids"));
    await click("bids-detection-dialog-continue-btn");

    await browser.waitUntil(
      async () =>
        (await byId("bids-review-scan-error").isExisting()) ||
        (await byId("bids-review-confirm-btn").isClickable()),
      { timeout: 60_000, timeoutMsg: "BIDS metadata review did not become ready" },
    );
    if (await byId("bids-review-scan-error").isExisting()) {
      assert.fail(`BIDS metadata scan failed: ${await byId("bids-review-scan-error").getText()}`);
    }
    const groups = await browser.$$('[data-testid^="bids-group-card-"]');
    // Exact source slice timings differ; do not merge the two acquisition groups.
    assert.equal(groups.length, 2, "Expected two distinct acquisition metadata groups");
    const reviewedSubjects: string[] = [];
    for (const group of groups) {
      await click("bids-review-parameters-toggle", group);
      for (const [field, expected] of Object.entries({
        Manufacturer: "Siemens",
        ArterialSpinLabelingType: "PASL",
        M0Type: "Included",
        BolusCutOffTechnique: "PICORE",
      })) {
        const value = group.$(
          `[data-testid^="bids-group-parameter-value-"][data-testid$="-${field}"]`,
        );
        await value.waitForDisplayed();
        await value.scrollIntoView({ block: "center" });
        await value.waitForStable();
        assert.equal(await value.getText(), expected);
      }
      await click("bids-review-subjects-toggle", group);
      const labels = await group.$$('[data-testid^="bids-group-subject-label-"]');
      for (const label of labels) {
        await label.waitForDisplayed();
        await label.scrollIntoView({ block: "center" });
        await label.waitForStable();
        reviewedSubjects.push(await label.getText());
      }
    }
    assert.deepEqual(
      reviewedSubjects.sort(),
      SUBJECTS.map((subject) => `sub-${subject}`),
    );
    await click("bids-review-confirm-btn");

    await byId("data-par-editor").waitForDisplayed();
    await click("datapar-generalSettings-toggle");
    // Explicit low-quality integration try-out; quantification remains fully enabled.
    await select("field-Quality", "0");
    await click("datapar-m0-toggle");
    // BIDS2Legacy extracts the included M0 to derivative M0.nii before ASL processing.
    await select("field-M0", "separate_scan");
    await click("datapar-atlases-toggle");
    await select("field-Atlases", "Total");
    await browser.keys("Escape");
    await click("layout-nav-processing");

    await byId("pipeline-config").waitForDisplayed();
    await click("select-all-btn");
    await click("module-checkbox-structural");
    await click("module-checkbox-asl");
    await byId("worker-count-input").setValue("1");
    await browser.keys("Tab");
    const firstStart = await runAndWait(1, 4);
    const complete = await browser.$$(
      '[data-testid="subject-table"] [data-testid="status-complete"]',
    );
    assert.equal(complete.length, 4, "GUI must show both modules complete for both sessions");
    assert.match(await byId("population-eligibility").getText(), /2 of 2 sessions ready/);
    for (const subject of SUBJECTS) {
      const session = `sub-${subject}_${SESSION}`;
      for (const module of ["Structural", "ASL"]) {
        const moduleName = `xASL_module_${module}`;
        await assertFreshFile(
          path.join(
            output,
            "lock",
            moduleName,
            session,
            module === "ASL" ? `${moduleName}_ASL_1` : moduleName,
            "999_ready.status",
          ),
          firstStart,
        );
      }
      assertReadableNifti(
        await assertFreshFile(path.join(output, session, "ASL_1/CBF.nii.gz"), firstStart),
      );
      const qc = JSON.parse(
        (
          await assertFreshFile(
            path.join(output, session, `QC_collection_${session}.json`),
            firstStart,
          )
        ).toString(),
      );
      assert.ok(Object.keys(qc.Structural).length > 3 && Object.keys(qc.ASL.ASL_1).length > 3);
    }
    await click("module-checkbox-structural");
    await click("module-checkbox-asl");
    await click("population-checkbox");
    const populationStart = await runAndWait(2, 1);
    await byId("population-status-complete").waitForExist();
    await assertFreshFile(
      path.join(output, "lock/xASL_module_Population/xASL_module_Population/999_ready.status"),
      populationStart,
    );
    assertReadableNifti(
      await assertFreshFile(
        path.join(output, "Population/Templates/CBF_n2_bs-mean.nii.gz"),
        populationStart,
      ),
    );
    for (const subject of SUBJECTS) {
      assertReadableNifti(
        await assertFreshFile(
          path.join(output, `Population/qCBF_sub-${subject}_${SESSION}_ASL_1.nii.gz`),
          firstStart,
        ),
      );
    }
    const stats = path.join(output, "Population/Stats");
    const tables = (await readdir(stats)).filter((name) => /^mean_qCBF_.*Total.*\.tsv$/.test(name));
    assert.ok(tables.length > 0, "Population ROI statistics missing");
    const table = (await assertFreshFile(path.join(stats, tables[0]), populationStart)).toString();
    for (const subject of SUBJECTS) assert.ok(table.includes(subject));
    const retainedComplete = await browser.$$(
      '[data-testid="subject-table"] [data-testid="status-complete"]',
    );
    assert.equal(retainedComplete.length, 4, "Population must retain completed subject modules");
    assert.match(await byId("population-eligibility").getText(), /2 of 2 sessions ready/);
    await browser.saveScreenshot(
      path.join(process.env.E2E_ARTIFACT_DIR!, "full-analysis-completed.png"),
    );
  });
});

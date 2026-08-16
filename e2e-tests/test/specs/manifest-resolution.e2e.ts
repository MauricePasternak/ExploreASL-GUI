import { $, $$, browser, expect } from "@wdio/globals";

import {
  MANIFEST_DISAGREEMENTS_ROUTE,
  MANIFEST_DISAGREEMENTS_SCENARIO,
  resetAndLoadScenario,
} from "../support/application";

describe("Manifest verdict resolution", () => {
  beforeEach(async () => {
    await resetAndLoadScenario(MANIFEST_DISAGREEMENTS_SCENARIO, MANIFEST_DISAGREEMENTS_ROUTE);
  });

  async function textContent(selector: string): Promise<string> {
    return browser.execute(
      (target) => document.querySelector(target)?.textContent?.trim() ?? "",
      selector,
    );
  }

  async function waitForTextContent(selector: string, expected: string): Promise<void> {
    await browser.waitUntil(async () => (await textContent(selector)) === expected, {
      timeout: 15_000,
      interval: 100,
      timeoutMsg: `Expected ${selector} to contain ${expected}.`,
    });
  }

  it("resolves seeded reviewer disagreements before allowing preview", async () => {
    await expect($("[data-testid='verdict-resolution']")).toHaveText(
      expect.stringContaining("Verdict Resolution"),
    );

    const disagreementRows = await $$('[data-testid="verdict-resolution-table"] tbody tr');
    expect(disagreementRows).toHaveLength(2);
    await waitForTextContent("[data-testid='resolution-state-sub-01_01']", "Resolved");
    await waitForTextContent("[data-testid='resolution-state-sub-02_01']", "Pending");

    await waitForTextContent("[data-testid='view-images-sub-02_01']", "View Images/Reports");
    await waitForTextContent("[data-testid='view-qc-metrics-sub-02_01']", "QC Metrics");
    await waitForTextContent("[data-testid='view-logs-sub-02_01']", "View Logs");
    await expect($("[data-testid='resolution-next-button']")).toBeDisabled();

    await $("[data-testid='bulk-resolve-11111111-1111-4111-8111-111111111111']").click();

    await expect($("[data-testid='resolution-remaining']")).toHaveText(
      "All disagreements resolved",
    );
    await waitForTextContent("[data-testid='resolution-state-sub-02_01']", "Resolved");
    await expect($("[data-testid='resolution-next-button']")).toBeEnabled();
  });
});

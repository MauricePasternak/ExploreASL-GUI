import { browser, expect } from "@wdio/globals";

import { resetToLanding } from "../support/application";

describe("Landing Page", () => {
  beforeEach(async () => {
    await resetToLanding();
  });

  it("should display the app title", async () => {
    const title = await $("h1");
    const text = await title.getText();
    expect(text).toContain("ExploreASL");
  });

  it("should show first-run guidance", async () => {
    const btn = await $('[data-testid="welcome-open-settings-btn"]');
    await btn.waitForExist({ timeout: 10000 });
    const label = await browser.execute(
      () =>
        document.querySelector('[data-testid="welcome-open-settings-btn"]')?.textContent?.trim() ??
        "",
    );
    expect(label).toContain("Open Settings");
  });
});

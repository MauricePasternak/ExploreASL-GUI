import { browser } from "@wdio/globals";

import { resetToLanding } from "../support/application";

describe("Landing Page", () => {
  beforeEach(async () => {
    await resetToLanding();
  });

  it("should display the app title", async () => {
    const title = await $('[data-testid="landing-hero-title"]');
    await title.waitForExist({ timeout: 15_000 });
    await browser.waitUntil(
      async () => {
        const text = await browser.execute(
          () =>
            document.querySelector('[data-testid="landing-hero-title"]')?.textContent?.trim() ??
            document.querySelector("h1")?.textContent?.trim() ??
            "",
        );
        return text.includes("ExploreASL");
      },
      {
        timeout: 15_000,
        interval: 100,
        timeoutMsg: "Expected landing page title to contain 'ExploreASL'.",
      },
    );
  });

  it("should show first-run guidance", async () => {
    const btn = await $('[data-testid="welcome-open-settings-btn"]');
    await btn.waitForExist({ timeout: 15_000 });
    await browser.waitUntil(
      async () => {
        const label = await browser.execute(
          () =>
            document
              .querySelector('[data-testid="welcome-open-settings-btn"]')
              ?.textContent?.trim() ?? "",
        );
        return label.includes("Open Settings");
      },
      {
        timeout: 15_000,
        interval: 100,
        timeoutMsg: "Expected welcome card button to contain 'Open Settings'.",
      },
    );
  });
});

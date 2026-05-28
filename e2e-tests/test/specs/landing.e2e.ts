import { browser, expect } from "@wdio/globals";

describe("Landing Page", () => {
  beforeEach(async () => {
    await browser.url("/");
  });

  it("should display the app title", async () => {
    const title = await $("h1");
    const text = await title.getText();
    expect(text).toContain("ExploreASL");
  });

  it("should show New Project button", async () => {
    const btn = await $('[data-testid="landing-new-project-btn"]');
    await btn.waitForExist({ timeout: 10000 });
    const text = await btn.getText();
    expect(text).toContain("New Project");
  });

  it("should show Open Project button", async () => {
    const btn = await $('[data-testid="landing-open-project-btn"]');
    await btn.waitForExist({ timeout: 10000 });
    const text = await btn.getText();
    expect(text).toContain("Open Project");
  });
});
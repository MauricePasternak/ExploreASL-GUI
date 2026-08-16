import { afterEach, describe, expect, it, vi } from "vitest";

import { renderBootstrapError } from "./bootstrapError";

describe("renderBootstrapError", () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it("replaces the root with a visible startup error", () => {
    const root = document.createElement("main");
    root.textContent = "Loading";
    document.body.append(root);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    renderBootstrapError(root, new Error("bridge import failed"));

    expect(root).toHaveTextContent("ExploreASL GUI could not start.");
    expect(root.querySelector('[role="alert"]')).toHaveTextContent("bridge import failed");
    expect(consoleError).toHaveBeenCalledWith(
      "[bootstrap] Application startup failed:",
      expect.any(Error),
    );
  });
});

import { render, screen, cleanup } from "@testing-library/react";
import { RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../App", () => ({
  default: ({ e2e }: { e2e?: { enabled: true } }) => (
    <div data-testid="router-app" data-e2e={e2e?.enabled ?? false} />
  ),
}));

import { createAppRouter } from "./router";

describe("createAppRouter", () => {
  afterEach(() => {
    cleanup();
    window.location.hash = "#/";
  });

  it("renders App and preserves hash routing", async () => {
    window.location.hash = "#/";
    const router = createAppRouter();

    render(<RouterProvider router={router} />);
    expect(screen.getByTestId("router-app")).toHaveAttribute("data-e2e", "false");

    await router.navigate("/overview");
    expect(window.location.hash).toBe("#/overview");
  });

  it("forwards E2E options to App without duplicate routes", () => {
    const router = createAppRouter({
      e2e: { enabled: true, onReady: vi.fn() },
    });

    render(<RouterProvider router={router} />);

    expect(screen.getByTestId("router-app")).toHaveAttribute("data-e2e", "true");
    expect(router.routes).toHaveLength(1);
  });
});

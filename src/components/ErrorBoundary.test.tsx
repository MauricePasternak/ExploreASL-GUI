import { cleanup, render, screen } from "@testing-library/react";
import { TestMantineProvider as MantineProvider } from "../test/render";
import { afterEach, describe, expect, it, vi } from "vitest";

import ErrorBoundary from "./ErrorBoundary";

afterEach(cleanup);

function ThrowingComponent(): never {
  throw new Error("boom");
}

describe("ErrorBoundary", () => {
  it("renders a fallback alert when a child throws", () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    render(
      <MantineProvider env="test">
        <ErrorBoundary>
          <ThrowingComponent />
        </ErrorBoundary>
      </MantineProvider>,
    );

    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
    consoleErrorSpy.mockRestore();
  });
});

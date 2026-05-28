import { render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { describe, expect, it, vi } from "vitest";

import ErrorBoundary from "./ErrorBoundary";

function ThrowingComponent(): never {
  throw new Error("boom");
}

describe("ErrorBoundary", () => {
  it("renders a fallback alert when a child throws", () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    render(
      <MantineProvider>
        <ErrorBoundary>
          <ThrowingComponent />
        </ErrorBoundary>
      </MantineProvider>,
    );

    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
    consoleErrorSpy.mockRestore();
  });
});

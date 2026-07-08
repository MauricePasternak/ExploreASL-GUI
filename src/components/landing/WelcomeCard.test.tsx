import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import WelcomeCard from "./WelcomeCard";

describe("WelcomeCard", () => {
  afterEach(() => cleanup());

  it("renders onboarding heading and numbered setup steps", () => {
    render(
      <MantineProvider>
        <WelcomeCard onOpenSettings={() => {}} />
      </MantineProvider>,
    );

    expect(screen.getByTestId("welcome-card")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /welcome to exploreasl gui/i })).toBeInTheDocument();
    expect(screen.getByTestId("welcome-card-description")).toHaveTextContent(/execution profile/i);
    expect(screen.getByTestId("welcome-card-steps")).toHaveTextContent(/open settings/i);
    expect(screen.getByTestId("welcome-card-steps")).toHaveTextContent(/add a matlab profile/i);
    expect(screen.getByTestId("welcome-card-steps")).toHaveTextContent(
      /create your first project/i,
    );
    expect(screen.getByTestId("welcome-card-project-types")).toBeInTheDocument();
    expect(screen.getByTestId("welcome-card-project-types")).toHaveTextContent(/dicom projects/i);
    expect(screen.getByTestId("welcome-card-project-types")).toHaveTextContent(/bids projects/i);
  });

  it("calls onOpenSettings when Open Settings is clicked", () => {
    const onOpenSettings = vi.fn();

    render(
      <MantineProvider>
        <WelcomeCard onOpenSettings={onOpenSettings} />
      </MantineProvider>,
    );

    fireEvent.click(screen.getByTestId("welcome-open-settings-btn"));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });
});

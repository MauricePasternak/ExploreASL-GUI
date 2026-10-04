import { MantineProvider, type MantineProviderProps } from "@mantine/core";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";

export function TestMantineProvider({ theme, ...props }: MantineProviderProps) {
  // env="test" skips transition rendering, but the hook still schedules animations.
  return (
    <MantineProvider
      {...props}
      env="test"
      theme={{ cursorType: "pointer", ...theme, respectReducedMotion: true }}
    />
  );
}

// Test helpers do not participate in Fast Refresh.
// oxlint-disable-next-line react/only-export-components
export function renderWithMantine(ui: ReactNode) {
  return render(<TestMantineProvider>{ui}</TestMantineProvider>);
}

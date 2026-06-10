import { render, screen, fireEvent } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { describe, expect, it, vi } from "vitest";

import { PVCConfig } from "./PVCConfig";

function renderWithMantine(ui: React.ReactNode) {
  return render(<MantineProvider>{ui}</MantineProvider>);
}

describe("PVCConfig", () => {
  it("renders PVC toggle", () => {
    renderWithMantine(
      <PVCConfig
        bPVCNativeSpace={undefined}
        bPVCGaussianMM={undefined}
        PVCNativeSpaceKernel={undefined}
        onBpvChange={() => {}}
        onGaussianChange={() => {}}
        onKernelChange={() => {}}
      />,
    );

    expect(screen.getAllByText(/partial volume correction/i).length).toBeGreaterThan(0);
  });

  it("shows kernel fields when PVC is enabled", () => {
    renderWithMantine(
      <PVCConfig
        bPVCNativeSpace={true}
        bPVCGaussianMM={false}
        PVCNativeSpaceKernel={[5, 5, 1]}
        onBpvChange={() => {}}
        onGaussianChange={() => {}}
        onKernelChange={() => {}}
      />,
    );

    expect(screen.getAllByText(/kernel size/i).length).toBeGreaterThan(0);
  });

  it("hides kernel fields when PVC is disabled", () => {
    const { container } = renderWithMantine(
      <PVCConfig
        bPVCNativeSpace={false}
        bPVCGaussianMM={false}
        PVCNativeSpaceKernel={[5, 5, 1]}
        onBpvChange={() => {}}
        onGaussianChange={() => {}}
        onKernelChange={() => {}}
      />,
    );

    const kernelTexts = container.querySelectorAll("p");
    const kernelEl = Array.from(kernelTexts).find((el) =>
      el.textContent?.match(/kernel size/i),
    );
    expect(kernelEl).toBeUndefined();
  });

  it("shows 'Kernel FWHM (mm)' when Gaussian is on", () => {
    renderWithMantine(
      <PVCConfig
        bPVCNativeSpace={true}
        bPVCGaussianMM={true}
        PVCNativeSpaceKernel={[10, 10, 4]}
        onBpvChange={() => {}}
        onGaussianChange={() => {}}
        onKernelChange={() => {}}
      />,
    );

    expect(screen.getAllByText(/kernel fwhm/i).length).toBeGreaterThan(0);
  });

  it("shows Gaussian toggle when PVC is enabled", () => {
    renderWithMantine(
      <PVCConfig
        bPVCNativeSpace={true}
        bPVCGaussianMM={false}
        PVCNativeSpaceKernel={[5, 5, 1]}
        onBpvChange={() => {}}
        onGaussianChange={() => {}}
        onKernelChange={() => {}}
      />,
    );

    expect(screen.getAllByText(/gaussian/i).length).toBeGreaterThan(0);
  });

  it("treats undefined bPVCNativeSpace as true (default on)", () => {
    renderWithMantine(
      <PVCConfig
        bPVCNativeSpace={undefined}
        bPVCGaussianMM={undefined}
        PVCNativeSpaceKernel={undefined}
        onBpvChange={() => {}}
        onGaussianChange={() => {}}
        onKernelChange={() => {}}
      />,
    );

    expect(screen.getAllByText(/kernel size/i).length).toBeGreaterThan(0);
  });
});

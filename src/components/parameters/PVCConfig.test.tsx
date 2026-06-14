import { render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { describe, expect, it } from "vitest";

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
        showAdvanced={false}
      />,
    );

    expect(screen.getAllByText(/partial volume correction/i).length).toBeGreaterThan(0);
  });

  it("shows kernel fields when PVC and showAdvanced are enabled", () => {
    renderWithMantine(
      <PVCConfig
        bPVCNativeSpace={true}
        bPVCGaussianMM={false}
        PVCNativeSpaceKernel={[5, 5, 1]}
        onBpvChange={() => {}}
        onGaussianChange={() => {}}
        onKernelChange={() => {}}
        showAdvanced={true}
      />,
    );

    expect(screen.getAllByText(/kernel size/i).length).toBeGreaterThan(0);
  });

  it("hides kernel fields when PVC is disabled, even if showAdvanced is true", () => {
    const { container } = renderWithMantine(
      <PVCConfig
        bPVCNativeSpace={false}
        bPVCGaussianMM={false}
        PVCNativeSpaceKernel={[5, 5, 1]}
        onBpvChange={() => {}}
        onGaussianChange={() => {}}
        onKernelChange={() => {}}
        showAdvanced={true}
      />,
    );

    const labels = container.querySelectorAll("span");
    const kernelEl = Array.from(labels).find((el) =>
      el.textContent?.match(/kernel size/i),
    );
    expect(kernelEl).toBeUndefined();
  });

  it("hides kernel fields when showAdvanced is false, even if PVC is enabled", () => {
    const { container } = renderWithMantine(
      <PVCConfig
        bPVCNativeSpace={true}
        bPVCGaussianMM={false}
        PVCNativeSpaceKernel={[5, 5, 1]}
        onBpvChange={() => {}}
        onGaussianChange={() => {}}
        onKernelChange={() => {}}
        showAdvanced={false}
      />,
    );

    const labels = container.querySelectorAll("span");
    const kernelEl = Array.from(labels).find((el) =>
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
        showAdvanced={true}
      />,
    );

    expect(screen.getAllByText(/kernel fwhm/i).length).toBeGreaterThan(0);
  });

  it("shows Gaussian toggle when PVC is enabled and showAdvanced is true", () => {
    renderWithMantine(
      <PVCConfig
        bPVCNativeSpace={true}
        bPVCGaussianMM={false}
        PVCNativeSpaceKernel={[5, 5, 1]}
        onBpvChange={() => {}}
        onGaussianChange={() => {}}
        onKernelChange={() => {}}
        showAdvanced={true}
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
        showAdvanced={true}
      />,
    );

    expect(screen.getAllByText(/kernel size/i).length).toBeGreaterThan(0);
  });
});

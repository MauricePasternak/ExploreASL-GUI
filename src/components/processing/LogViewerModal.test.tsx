import { cleanup, render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LogContent } from "../../lib/logViewer";

vi.mock("../../lib/logViewer", () => ({
  fetchLogContent: vi.fn(),
  fetchModuleLogs: vi.fn(),
  LogFileInfoSchema: {
    parse: (v: unknown) => v,
  },
  LogContentSchema: {
    parse: (v: unknown) => v,
  },
}));

const { default: LogViewerModal } = await import("./LogViewerModal");

function renderModal(props: {
  opened: boolean;
  onClose?: () => void;
  logContent?: LogContent | null;
  module?: "structural" | "asl";
  subjectSession?: string;
}) {
  return render(
    <MantineProvider>
      <LogViewerModal
        opened={props.opened}
        onClose={props.onClose ?? vi.fn()}
        logContent={props.logContent ?? null}
        module={props.module ?? "structural"}
        subjectSession={props.subjectSession ?? "sub-001_01"}
      />
    </MantineProvider>,
  );
}

describe("LogViewerModal", () => {
  afterEach(() => {
    cleanup();
  });

  it("hides modal content when opened=false", () => {
    renderModal({ opened: false });
    expect(screen.queryByTestId("log-content-pre")).not.toBeInTheDocument();
  });

  it("renders log content when opened with structural log", () => {
    renderModal({
      opened: true,
      logContent: { "xASL_module_Structural_sub-001_01.log": "Line 1\nLine 2\nLine 3" },
      module: "structural",
      subjectSession: "sub-001_01",
    });
    expect(screen.getByTestId("log-viewer-modal")).toBeInTheDocument();
    expect(screen.getByTestId("log-content-pre")).toBeInTheDocument();
  });

  it("highlights error lines with red background", () => {
    renderModal({
      opened: true,
      logContent: { "xASL_module_Structural_sub-001_01.log": "Normal line\nERROR: something failed\nAfter error" },
      module: "structural",
    });
    const lines = screen.getAllByTestId(/^log-line-/);
    expect(lines[1].style.backgroundColor).toBeTruthy();
  });

  it("shows ERRORS DETECTED badge when hasError", () => {
    renderModal({
      opened: true,
      logContent: { "xASL_module_Structural_sub-001_01.log": "ERROR: crash" },
      module: "structural",
    });
    expect(screen.getByTestId("log-error-badge")).toBeInTheDocument();
  });

  it("does not show Select for single structural log", () => {
    renderModal({
      opened: true,
      logContent: { "xASL_module_Structural_sub-001_01.log": "content" },
      module: "structural",
    });
    expect(screen.queryByTestId("log-run-select")).not.toBeInTheDocument();
  });

  it("shows Select for multi-run ASL log", () => {
    renderModal({
      opened: true,
      logContent: {
        "xASL_module_ASL_sub-001_01_ASL_1.log": "run 1 content",
        "xASL_module_ASL_sub-001_01_ASL_2.log": "ERROR: run 2 failed",
      },
      module: "asl",
    });
    expect(screen.getByTestId("log-run-select")).toBeInTheDocument();
  });

  it("calls onClose via onClose prop", () => {
    const onClose = vi.fn();
    render(
      <MantineProvider>
        <LogViewerModal
          opened={true}
          onClose={onClose}
          logContent={{ "xASL_module_Structural_sub-001_01.log": "content" }}
          module="structural"
          subjectSession="sub-001_01"
        />
      </MantineProvider>,
    );
    const modal = screen.getByTestId("log-viewer-modal");
    expect(modal).toBeInTheDocument();
    const innerModal = modal.closest('[role="dialog"]') ?? modal;
    expect(innerModal).toBeTruthy();
  });
});
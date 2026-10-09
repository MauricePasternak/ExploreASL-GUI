import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TestMantineProvider as MantineProvider } from "../../test/render";
import { afterEach, describe, expect, it, vi } from "vitest";

import MetadataModal from "./MetadataModal";
import MetadataGrouping from "./MetadataGrouping";
import { invoke } from "@tauri-apps/api/core";
import { activateProjectLease, resetProjectLifecycleForTests } from "../../lib/projectLifecycle";
import { useProjectStore } from "../../stores/projectStore";
import { projectFixture } from "../../test/projectFixtures";
import type { MetadataGroupFormValues } from "./metadataModalTypes";

const emptyValues: MetadataGroupFormValues = {
  label: "Global Defaults",
  bidsParams: {},
};

const validBidsParams = {
  ArterialSpinLabelingType: "PCASL" as const,
  PostLabelingDelay: [1.8],
  MRAcquisitionType: "3D" as const,
  MagneticFieldStrength: 3,
  Manufacturer: "Siemens" as const,
  ASLContext: "control,label",
  M0Type: "Separate" as const,
  LabelingDuration: 1.8,
  BackgroundSuppression: false,
};

function modalScope() {
  return within(screen.getByTestId("metadata-modal"));
}

function testId(id: string): HTMLElement {
  return modalScope().getByTestId(id);
}

function queryTestId(id: string): HTMLElement[] {
  return modalScope().queryAllByTestId(id);
}

afterEach(() => {
  cleanup();
  useProjectStore.getState().cancelAutosave();
  resetProjectLifecycleForTests();
  vi.mocked(invoke).mockReset();
});

function renderModal(
  props: Partial<{
    initialValues: MetadataGroupFormValues;
    onSubmit: (values: MetadataGroupFormValues) => void;
  }> = {},
) {
  const onSubmit = (props.onSubmit ?? vi.fn()) as any;
  render(
    <MantineProvider env="test">
      <MetadataModal
        opened
        title="Configure Metadata"
        initialValues={props.initialValues ?? emptyValues}
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />
    </MantineProvider>,
  );
  return { onSubmit };
}

describe("MetadataModal", () => {
  it.each(["edit", "override"] as const)(
    "%s waits for native acceptance, retains rejected draft and retries",
    async (mode) => {
      const before = projectFixture();
      before.document.mappingState = {
        metadataGroups: [{ id: "global-defaults", label: "Global", bidsParams: validBidsParams }],
        subjectRows: [{ id: "FOO/01", subject: "FOO", session: "01", groupId: "global-defaults" }],
      };
      useProjectStore.setState(useProjectStore.getInitialState(), true);
      useProjectStore.getState().acceptSnapshot(before);
      activateProjectLease("project-1", "/project");
      let reject!: (error: Error) => void;
      vi.mocked(invoke).mockImplementationOnce(
        () =>
          new Promise((_, fail) => {
            reject = fail;
          }),
      );
      render(
        <MantineProvider env="test">
          <MetadataGrouping />
        </MantineProvider>,
      );
      fireEvent.click(screen.getByTestId("metadata-row-checkbox-FOO-01"));
      fireEvent.click(
        screen.getByTestId(
          mode === "edit" ? "metadata-edit-defaults-btn" : "metadata-apply-override-btn",
        ),
      );
      if (mode === "override") {
        fireEvent.click(testId("field-background-suppression"));
        fireEvent.click(testId("field-background-suppression"));
        for (const [field, name] of [
          ["arterial-spin-labeling-type", "PCASL"],
          ["mr-acquisition-type", "3D"],
          ["manufacturer", "Siemens"],
          ["m0-type", "Separate"],
        ]) {
          fireEvent.click(testId(`field-${field}`));
          fireEvent.click(screen.getByRole("option", { name }));
        }
        for (const [field, value] of [
          ["asl-context", "control,label"],
          ["post-labeling-delay", "1.8"],
          ["labeling-duration", "1.8"],
          ["magnetic-field-strength", "3"],
        ]) {
          fireEvent.change(testId(`field-${field}`), { target: { value } });
        }
      }
      fireEvent.change(testId("modal-group-label-input"), { target: { value: "Entered draft" } });
      fireEvent.click(testId("modal-save-btn"));
      await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
      const cancelDisabled = screen.queryByTestId("modal-cancel-btn")?.hasAttribute("disabled");
      const form = screen.queryByTestId("modal-save-btn")?.closest("form");
      if (form) fireEvent.submit(form);
      fireEvent.keyDown(document.body, { key: "Escape" });
      expect(useProjectStore.getState().project!.mappingState).toEqual(
        before.document.mappingState,
      );
      await act(async () => {
        reject(new Error("Native rejected metadata"));
      });
      expect(cancelDisabled).toBe(true);
      expect(await screen.findByText("Native rejected metadata")).toBeInTheDocument();
      expect(testId("modal-group-label-input")).toHaveValue("Entered draft");
      expect(screen.getByTestId("metadata-row-checkbox-FOO-01")).toBeChecked();
      expect(invoke).toHaveBeenCalledTimes(1);
      const submission = vi.mocked(invoke).mock.calls[0][1] as {
        edit: {
          mapping: typeof before.document.mappingState;
        };
      };
      const mapping = submission.edit.mapping;
      const group = mapping.metadataGroups![mode === "edit" ? 0 : 1];
      expect(group).toEqual({
        id: mode === "edit" ? "global-defaults" : expect.stringMatching(/^override-/),
        label: "Entered draft",
        bidsParams:
          mode === "edit" ? validBidsParams : { ...validBidsParams, PostLabelingDelay: 1.8 },
      });
      expect(mapping.subjectRows![0]).toEqual({
        ...before.document.mappingState.subjectRows![0],
        groupId: group.id,
      });
      const accepted = structuredClone(before);
      accepted.acceptedRevision = 1;
      let resolve!: (value: typeof accepted) => void;
      vi.mocked(invoke).mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolve = done;
          }),
      );
      fireEvent.click(testId("modal-save-btn"));
      await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
      accepted.document.mappingState = (
        vi.mocked(invoke).mock.calls[1][1] as typeof submission
      ).edit.mapping;
      expect(screen.getByTestId("modal-save-btn")).toBeInTheDocument();
      await act(async () => {
        resolve(accepted);
      });
      await waitFor(() => expect(screen.queryByTestId("modal-save-btn")).not.toBeInTheDocument());
      expect(screen.getByTestId("metadata-row-checkbox-FOO-01")).toHaveProperty(
        "checked",
        mode === "edit",
      );
    },
  );
  it("does not dismiss an editor after its project activation expires", async () => {
    const before = projectFixture();
    before.document.mappingState.metadataGroups = [
      { id: "global-defaults", label: "Global", bidsParams: validBidsParams },
    ];
    useProjectStore.setState(useProjectStore.getInitialState(), true);
    useProjectStore.getState().acceptSnapshot(before);
    activateProjectLease("project-1", "/project");
    let resolve!: (value: typeof before) => void;
    vi.mocked(invoke).mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const mounted = render(
      <MantineProvider env="test">
        <MetadataGrouping />
      </MantineProvider>,
    );
    fireEvent.click(screen.getByTestId("metadata-edit-defaults-btn"));
    fireEvent.click(testId("modal-save-btn"));
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    activateProjectLease("project-1", "/project");
    await act(async () => {
      resolve(before);
    });
    expect(screen.getByTestId("modal-save-btn")).toBeInTheDocument();
    mounted.unmount();
  });

  it("renders required fields legend and displays asterisks", () => {
    renderModal();

    const legend = modalScope().getByTestId("metadata-hint-legend");
    expect(legend).toHaveTextContent(/Required fields for ExploreASL have a red asterisk/i);

    // ASL Context is marked as "important" (required) so it should have an asterisk
    const aslContextWrapper = testId("field-asl-context").closest(".mantine-InputWrapper-root");
    expect(aslContextWrapper).toHaveTextContent("*");

    // Echo Time is NOT "important" (required) so it should NOT have an asterisk
    const echoTimeWrapper = testId("field-echo-time").closest(".mantine-InputWrapper-root");
    expect(echoTimeWrapper).not.toHaveTextContent("*");
  });

  it("renders stacked section cards in order", () => {
    renderModal();

    const sectionIds = [
      "metadata-section-group-label",
      "metadata-section-asl-m0-context",
      "metadata-section-vendor-sequence",
      "metadata-section-core-asl",
    ];

    const sections = sectionIds.map((id) => modalScope().getByTestId(id));

    for (let i = 1; i < sections.length; i++) {
      expect(
        sections[i - 1].compareDocumentPosition(sections[i]) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }

    expect(within(sections[1]).getByText("ASL / M0 Context")).toBeInTheDocument();
    expect(within(sections[2]).getByText("Vendor & Sequence Related")).toBeInTheDocument();
    expect(within(sections[3]).getByText("Core ASL Parameters")).toBeInTheDocument();
  });

  it("populates initial values in section fields", () => {
    renderModal({
      initialValues: {
        label: "GENFI Defaults",
        bidsParams: {
          Manufacturer: "Siemens",
          ArterialSpinLabelingType: "PCASL",
          PostLabelingDelay: [1.8, 2.0],
          M0Type: "Separate",
          M0_GMScaleFactor: 1.5,
        },
      },
    });

    expect(testId("modal-group-label-input")).toHaveValue("GENFI Defaults");
    expect(testId("field-post-labeling-delay")).toHaveValue("1.8, 2");
    expect(testId("field-manufacturer")).toHaveValue("Siemens");
    expect(testId("field-m0-type")).toHaveValue("Separate");
    expect(testId("field-m0-gm-scale-factor")).toHaveValue("1.5");
  });

  it("shows PCASL-specific fields when type is PCASL", () => {
    renderModal({
      initialValues: {
        label: "Test",
        bidsParams: { ArterialSpinLabelingType: "PCASL" },
      },
    });

    expect(queryTestId("field-labeling-duration").length).toBeGreaterThan(0);
    expect(queryTestId("field-pcasl-type").length).toBeGreaterThan(0);
    expect(queryTestId("field-casl-type")).toHaveLength(0);
    expect(queryTestId("field-bolus-cutoff-flag")).toHaveLength(0);
  });

  it("shows CASL-specific fields when type is CASL", () => {
    renderModal({
      initialValues: {
        label: "Test",
        bidsParams: { ArterialSpinLabelingType: "CASL" },
      },
    });

    expect(queryTestId("field-labeling-duration").length).toBeGreaterThan(0);
    expect(queryTestId("field-casl-type").length).toBeGreaterThan(0);
    expect(queryTestId("field-pcasl-type")).toHaveLength(0);
  });

  it("shows PASL bolus cutoff fields when flag is enabled", () => {
    renderModal({
      initialValues: {
        label: "Test",
        bidsParams: {
          ArterialSpinLabelingType: "PASL",
          BolusCutOffFlag: true,
        },
      },
    });

    expect(queryTestId("field-bolus-cutoff-flag").length).toBeGreaterThan(0);
    expect(queryTestId("field-bolus-cutoff-delay").length).toBeGreaterThan(0);
    expect(queryTestId("field-bolus-cutoff-technique").length).toBeGreaterThan(0);
    expect(queryTestId("field-labeling-duration")).toHaveLength(0);
  });

  it("shows background suppression pulse fields when enabled", () => {
    renderModal({
      initialValues: {
        label: "Test",
        bidsParams: { BackgroundSuppression: true },
      },
    });

    expect(queryTestId("field-bg-suppression-pulses").length).toBeGreaterThan(0);
    expect(queryTestId("field-bg-suppression-pulse-time").length).toBeGreaterThan(0);
  });

  it("shows slice timing when MR acquisition type is 2D", () => {
    renderModal({
      initialValues: {
        label: "Test",
        bidsParams: { MRAcquisitionType: "2D" },
      },
    });

    expect(queryTestId("field-slice-timing").length).toBeGreaterThan(0);
  });

  it("submits comma-separated post labeling delay as array", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderModal({
      initialValues: {
        label: "Test Group",
        bidsParams: { ...validBidsParams },
      },
    });

    const delayInput = testId("field-post-labeling-delay");
    fireEvent.change(delayInput, { target: { value: "1.8, 2.0, 2.2" } });
    await user.click(testId("modal-save-btn"));

    expect(onSubmit).toHaveBeenCalled();
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      label: "Test Group",
      bidsParams: {
        ArterialSpinLabelingType: "PCASL",
        PostLabelingDelay: [1.8, 2, 2.2],
      },
    });
  });

  it("submits background suppression pulse time array from comma input", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderModal({
      initialValues: {
        label: "Test",
        bidsParams: {
          ...validBidsParams,
          BackgroundSuppression: true,
          BackgroundSuppressionNumberPulses: 3,
        },
      },
    });

    fireEvent.change(testId("field-bg-suppression-pulse-time"), {
      target: { value: "1.465, 2.1, 2.6" },
    });
    await user.click(testId("modal-save-btn"));

    expect(onSubmit).toHaveBeenCalled();
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      bidsParams: {
        BackgroundSuppression: true,
        BackgroundSuppressionPulseTime: [1.465, 2.1, 2.6],
      },
    });
    expect(onSubmit.mock.calls[0][0].bidsParams).not.toHaveProperty("EchoTime");
  });

  it("supports completely clearing comma-delimited fields back to empty", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderModal({
      initialValues: {
        label: "Test Clear",
        bidsParams: {
          ...validBidsParams,
          BackgroundSuppression: true,
          BackgroundSuppressionNumberPulses: 3,
          BackgroundSuppressionPulseTime: [1.465, 2.1, 2.6],
        },
      },
    });

    const input = testId("field-bg-suppression-pulse-time");
    expect(input).toHaveValue("1.465, 2.1, 2.6");

    fireEvent.change(input, { target: { value: "" } });
    expect(input).toHaveValue("");

    await user.click(testId("modal-save-btn"));
    expect(onSubmit).toHaveBeenCalled();
    expect(onSubmit.mock.calls[0][0].bidsParams).not.toHaveProperty(
      "BackgroundSuppressionPulseTime",
    );
  });

  it("displays validation error when background suppression pulse time count does not match number of pulses", async () => {
    const user = userEvent.setup();
    renderModal({
      initialValues: {
        label: "Test Mismatch",
        bidsParams: {
          ...validBidsParams,
          BackgroundSuppression: true,
          BackgroundSuppressionNumberPulses: 2,
          BackgroundSuppressionPulseTime: [1.465, 2.1, 2.6],
        },
      },
    });

    await user.click(testId("modal-save-btn"));
    expect(
      screen.getByText(
        /Background Suppression Pulse Time count \(3\) must match Background Suppression Number Pulses \(2\)/i,
      ),
    ).toBeInTheDocument();
  });

  it("strips empty bidsParams keys on save", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderModal({
      initialValues: {
        label: "Sparse",
        bidsParams: { ...validBidsParams },
      },
    });

    await user.click(testId("modal-save-btn"));

    expect(onSubmit.mock.calls[0][0].bidsParams).toEqual(validBidsParams);
  });

  it("requires a non-empty group label", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderModal();

    await user.clear(testId("modal-group-label-input"));
    await user.click(testId("modal-save-btn"));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(modalScope().getByText("Label is required")).toBeInTheDocument();
  });

  it("renders tooltips for fields and reveals descriptions on hover", async () => {
    const user = userEvent.setup();
    renderModal();

    // Query the info icon by its aria-label
    const infoIcon = screen.getByLabelText("Info for ASL Context");
    expect(infoIcon).toBeInTheDocument();

    // The tooltip text should not be in the document initially
    expect(
      screen.queryByText(/Comma-separated sequence describing each volume/i),
    ).not.toBeInTheDocument();

    // Hover over the info icon
    await user.hover(infoIcon);

    // Now the tooltip text should be visible
    expect(
      screen.getByText(/Comma-separated sequence describing each volume/i),
    ).toBeInTheDocument();

    // Unhover the info icon
    await user.unhover(infoIcon);

    // The tooltip should disappear
    expect(
      screen.queryByText(/Comma-separated sequence describing each volume/i),
    ).not.toBeInTheDocument();
  });

  it("displays validation error for invalid comma number inputs", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderModal({
      initialValues: {
        label: "Test Group",
        bidsParams: { ArterialSpinLabelingType: "PCASL" },
      },
    });

    const delayInput = testId("field-post-labeling-delay");
    await user.clear(delayInput);
    await user.type(delayInput, "abc");
    await user.click(testId("modal-save-btn"));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(modalScope().getByText("Invalid number or list of numbers")).toBeInTheDocument();
  });

  it("enforces joint validation of PostLabelingDelay and BolusCutOffDelayTime in the UI", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderModal({
      initialValues: {
        label: "Test Group",
        bidsParams: {
          ArterialSpinLabelingType: "PASL" as const,
          PostLabelingDelay: [1.8, 0],
          MRAcquisitionType: "3D" as const,
          MagneticFieldStrength: 3,
          Manufacturer: "Siemens" as const,
          ASLContext: "control,label",
          M0Type: "Separate" as const,
          BolusCutOffFlag: true,
          BolusCutOffDelayTime: [0.8, 0],
          BolusCutOffTechnique: "Q2TIPS" as const,
          BackgroundSuppression: false,
        },
      },
    });

    // Valid submission with matching array sizes and zero positions
    await user.click(testId("modal-save-btn"));

    expect(onSubmit).toHaveBeenCalled();
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      bidsParams: expect.objectContaining({
        BolusCutOffFlag: true,
      }),
    });
  });
});

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import MetadataModal from "./MetadataModal";
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
});

function renderModal(
  props: Partial<{
    initialValues: MetadataGroupFormValues;
    onSubmit: (values: MetadataGroupFormValues) => void;
  }> = {},
) {
  const onSubmit = (props.onSubmit ?? vi.fn()) as any;
  render(
    <MantineProvider>
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
          BackgroundSuppressionNumberPulses: 4,
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

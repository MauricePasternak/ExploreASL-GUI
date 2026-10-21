import { notifications } from "@mantine/notifications";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assembleStudyPar } from "../../lib/tokenizerUtils";
import { StudyParJsonSchema, type MetadataGroup } from "../../schemas/importSchemas";
import { useImportStore } from "../../stores/importStore";
import { useProjectStore } from "../../stores/projectStore";
import { projectFixture } from "../../test/projectFixtures";
import { TestMantineProvider } from "../../test/render";
import MetadataGrouping from "./MetadataGrouping";

const paramsWithoutLabelingDuration: MetadataGroup["bidsParams"] = {
  ArterialSpinLabelingType: "PCASL",
  PostLabelingDelay: 1.8,
  MRAcquisitionType: "3D",
  MagneticFieldStrength: 3,
  Manufacturer: "Siemens",
  ASLContext: "control,label",
  M0Type: "Separate",
  BackgroundSuppression: false,
};
const validParams: MetadataGroup["bidsParams"] = {
  ...paramsWithoutLabelingDuration,
  LabelingDuration: 1.8,
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useProjectStore.getState().cancelAutosave();
  useProjectStore.setState(useProjectStore.getInitialState(), true);
});

function renderGroups(metadataGroups: MetadataGroup[], assignedGroupIds: string[]) {
  const snapshot = projectFixture();
  const subjectRows = assignedGroupIds.flatMap((groupId, index) =>
    ["01", "02"].map((session) => ({
      id: `SUB${index}/${session}`,
      subject: `SUB${index}`,
      session,
      groupId,
    })),
  );
  snapshot.document.mappingState = { metadataGroups, subjectRows };
  useProjectStore.getState().acceptSnapshot(snapshot);
  const setActiveStep = vi
    .spyOn(useImportStore.getState(), "setActiveStep")
    .mockImplementation(() => {});
  const showNotification = vi.spyOn(notifications, "show").mockReturnValue("validation-error");
  render(
    <TestMantineProvider>
      <MetadataGrouping />
    </TestMantineProvider>,
  );
  return { setActiveStep, showNotification, subjectRows };
}

describe("MetadataGrouping validation", () => {
  it("allows assigned vendor overrides with empty unused defaults and ignores other unused groups", () => {
    const metadataGroups: MetadataGroup[] = [
      { id: "global-defaults", label: "Global Defaults", bidsParams: {} },
      { id: "unused", label: "Unused override", bidsParams: {} },
      { id: "ge", label: "GE PCASL", bidsParams: { ...validParams, Manufacturer: "GE_product" } },
      {
        id: "siemens",
        label: "Siemens PASL",
        bidsParams: { ...paramsWithoutLabelingDuration, ArterialSpinLabelingType: "PASL" },
      },
      {
        id: "philips",
        label: "Philips PCASL",
        bidsParams: { ...validParams, Manufacturer: "Philips" },
      },
    ];
    const { setActiveStep, showNotification, subjectRows } = renderGroups(metadataGroups, [
      "ge",
      "siemens",
      "philips",
    ]);

    fireEvent.click(screen.getByTestId("metadata-next-btn"));

    expect(setActiveStep).toHaveBeenCalledExactlyOnceWith(4);
    expect(showNotification).not.toHaveBeenCalled();
    const studyPar = assembleStudyPar(metadataGroups, subjectRows);
    expect(studyPar.StudyPars).toHaveLength(3);
    expect(StudyParJsonSchema.safeParse(studyPar).success).toBe(true);
  });

  it.each(["global-defaults", "override"])(
    "blocks empty assigned %s metadata without inheriting valid unassigned metadata",
    (assignedGroupId) => {
      const metadataGroups: MetadataGroup[] = [
        { id: "global-defaults", label: "Global Defaults", bidsParams: validParams },
        { id: "override", label: "Override", bidsParams: validParams },
      ].map((group) => (group.id === assignedGroupId ? { ...group, bidsParams: {} } : group));
      const { setActiveStep, showNotification } = renderGroups(metadataGroups, [assignedGroupId]);

      fireEvent.click(screen.getByTestId("metadata-next-btn"));

      expect(setActiveStep).not.toHaveBeenCalled();
      expect(showNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          title: `Validation Error in Group "${assignedGroupId === "global-defaults" ? "Global Defaults" : "Override"}"`,
          message: expect.stringContaining("Arterial Spin Labeling Type is required."),
        }),
      );
    },
  );

  it("keeps conditional required-field checks for assigned overrides", () => {
    const { setActiveStep, showNotification } = renderGroups(
      [
        { id: "global-defaults", label: "Global Defaults", bidsParams: {} },
        {
          id: "override",
          label: "Override",
          bidsParams: paramsWithoutLabelingDuration,
        },
      ],
      ["override"],
    );

    fireEvent.click(screen.getByTestId("metadata-next-btn"));

    expect(setActiveStep).not.toHaveBeenCalled();
    expect(showNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Validation Error in Group "Override"',
        message: expect.stringContaining("Labeling Duration is required for PCASL."),
      }),
    );
  });
});

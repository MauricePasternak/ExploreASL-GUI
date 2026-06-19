import { Button, Group, Modal, Stack, TextInput } from "@mantine/core";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";

import { BIDS_FIELD_HINTS, stripEmptyBidsParams } from "./metadataFieldHints";
import {
  BidsCheckboxField,
  BidsCommaArrayField,
  BidsCommaNumberField,
  BidsNumberField,
  BidsSelectField,
  BidsTextField,
  MetadataHintLegend,
  MetadataSectionCard,
} from "./metadataModalFields";
import { MetadataGroupFormSchema, type MetadataGroupFormValues } from "./metadataModalTypes";

interface MetadataModalProps {
  opened: boolean;
  title: string;
  initialValues: MetadataGroupFormValues;
  onClose: () => void;
  onSubmit: (values: MetadataGroupFormValues) => void;
}

export default function MetadataModal({
  opened,
  title,
  initialValues,
  onClose,
  onSubmit,
}: MetadataModalProps) {
  const form = useForm<MetadataGroupFormValues>({
    resolver: zodResolver(MetadataGroupFormSchema) as any,
    defaultValues: initialValues,
    values: initialValues,
  });

  const { control, watch, register, handleSubmit, formState } = form;
  const aslType = watch("bidsParams.ArterialSpinLabelingType");
  const mrAcquisitionType = watch("bidsParams.MRAcquisitionType");
  const hasBackgroundSuppression = watch("bidsParams.BackgroundSuppression");
  const bolusCutOffFlag = watch("bidsParams.BolusCutOffFlag");
  const aslContext = watch("bidsParams.ASLContext") ?? "";
  const hasM0ScanInContext = aslContext
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .includes("m0scan");

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={title}
      centered
      size="xl"
      data-testid="metadata-modal"
    >
      <form
        onSubmit={handleSubmit((values) =>
          onSubmit({
            ...values,
            bidsParams: stripEmptyBidsParams({
              ...values.bidsParams,
              M0Type: hasM0ScanInContext ? "Integrated" : values.bidsParams.M0Type,
            }),
          }),
        )}
      >
        <Stack gap="md">
          <MetadataHintLegend />

          <MetadataSectionCard title="Group Label" testId="metadata-section-group-label">
            <TextInput
              label="Group Label"
              placeholder="Global Defaults"
              {...register("label")}
              error={formState.errors.label?.message}
              data-testid="modal-group-label-input"
            />
          </MetadataSectionCard>

          <MetadataSectionCard title="ASL / M0 Context" testId="metadata-section-asl-m0-context">
            <BidsTextField
              control={control}
              name="bidsParams.ASLContext"
              label="ASL Context"
              hint={BIDS_FIELD_HINTS.ASLContext}
              placeholder="m0scan, label, control, label, control"
              testId="field-asl-context"
            />
            {!hasM0ScanInContext && (
              <BidsSelectField
                control={control}
                name="bidsParams.M0Type"
                label="M0 Type"
                hint={BIDS_FIELD_HINTS.M0Type}
                data={["Separate", "Absent", "Estimate"]}
                testId="field-m0-type"
              />
            )}
            {hasM0ScanInContext && (
              <BidsSelectField
                control={control}
                name="bidsParams.M0Type"
                label="M0 Type"
                hint={BIDS_FIELD_HINTS.M0Type}
                data={["Integrated"]}
                testId="field-m0-type"
              />
            )}
            <BidsNumberField
              control={control}
              name="bidsParams.M0_GMScaleFactor"
              label="M0 GM Scale Factor"
              hint={BIDS_FIELD_HINTS.M0_GMScaleFactor}
              min={0}
              testId="field-m0-gm-scale-factor"
            />
            <BidsCommaArrayField
              control={control}
              name="bidsParams.DummyScanPositionInASL4D"
              label="Dummy Scan Position in ASL4D"
              hint={BIDS_FIELD_HINTS.DummyScanPositionInASL4D}
              testId="field-dummy-scan-position"
            />
            <BidsCommaArrayField
              control={control}
              name="bidsParams.RepetitionTimePreparationM0"
              label="Repetition Time Preparation M0"
              hint={BIDS_FIELD_HINTS.RepetitionTimePreparationM0}
              testId="field-repetition-time-prep-m0"
            />
          </MetadataSectionCard>

          <MetadataSectionCard
            title="Vendor & Sequence Related"
            testId="metadata-section-vendor-sequence"
          >
            <BidsSelectField
              control={control}
              name="bidsParams.Manufacturer"
              label="Manufacturer"
              hint={BIDS_FIELD_HINTS.Manufacturer}
              data={[
                { value: "GE_product", label: "GE" },
                { value: "Philips", label: "Philips" },
                { value: "Siemens", label: "Siemens" },
              ]}
              testId="field-manufacturer"
            />
            <BidsSelectField
              control={control}
              name="bidsParams.PulseSequenceType"
              label="Pulse Sequence Type"
              hint={BIDS_FIELD_HINTS.PulseSequenceType}
              data={[
                { value: "spiral", label: "Stack of Spirals" },
                { value: "GRASE", label: "GRadient and Spin Echo (GRaSE)" },
                { value: "EPI", label: "Echo Planar Imaging (EPI)" },
              ]}
              testId="field-pulse-sequence-type"
            />
            <BidsSelectField
              control={control}
              name="bidsParams.MRAcquisitionType"
              label="MR Acquisition Type"
              hint={BIDS_FIELD_HINTS.MRAcquisitionType}
              data={["2D", "3D"]}
              testId="field-mr-acquisition-type"
            />
            <BidsNumberField
              control={control}
              name="bidsParams.MagneticFieldStrength"
              label="Magnetic Field Strength (T)"
              hint={BIDS_FIELD_HINTS.MagneticFieldStrength}
              decimalScale={2}
              testId="field-magnetic-field-strength"
            />
            <BidsNumberField
              control={control}
              name="bidsParams.EchoTime"
              label="Echo Time"
              hint={BIDS_FIELD_HINTS.EchoTime}
              testId="field-echo-time"
            />
            <BidsNumberField
              control={control}
              name="bidsParams.RepetitionTimePreparation"
              label="Repetition Time Preparation"
              hint={BIDS_FIELD_HINTS.RepetitionTimePreparation}
              testId="field-repetition-time-prep"
            />
            <BidsCommaNumberField
              control={control}
              name="bidsParams.FlipAngle"
              label="Flip Angle"
              hint={BIDS_FIELD_HINTS.FlipAngle}
              testId="field-flip-angle"
            />
          </MetadataSectionCard>

          <MetadataSectionCard title="Core ASL Parameters" testId="metadata-section-core-asl">
            <BidsSelectField
              control={control}
              name="bidsParams.ArterialSpinLabelingType"
              label="Arterial Spin Labeling Type"
              hint={BIDS_FIELD_HINTS.ArterialSpinLabelingType}
              data={["CASL", "PCASL", "PASL"]}
              testId="field-arterial-spin-labeling-type"
            />
            <BidsCommaNumberField
              control={control}
              name="bidsParams.PostLabelingDelay"
              label="Post Labeling Delay"
              hint={BIDS_FIELD_HINTS.PostLabelingDelay}
              description="Comma-separated for multiple values. For multi-PLD schemes, place 0 where M0 and/or dummy ASL volumes are found"
              testId="field-post-labeling-delay"
            />

            {(aslType === "CASL" || aslType === "PCASL") && (
              <BidsCommaNumberField
                control={control}
                name="bidsParams.LabelingDuration"
                label="Labeling Duration"
                hint={BIDS_FIELD_HINTS.LabelingDuration}
                testId="field-labeling-duration"
              />
            )}

            {aslType === "PCASL" && (
              <BidsSelectField
                control={control}
                name="bidsParams.PCASLType"
                label="PCASL Type"
                hint={BIDS_FIELD_HINTS.PCASLType}
                data={["balanced", "unbalanced"]}
                testId="field-pcasl-type"
              />
            )}

            {aslType === "CASL" && (
              <BidsSelectField
                control={control}
                name="bidsParams.CASLType"
                label="CASL Type"
                hint={BIDS_FIELD_HINTS.CASLType}
                data={["single-coil", "double-coil"]}
                testId="field-casl-type"
              />
            )}

            {aslType === "PASL" && (
              <BidsCheckboxField
                control={control}
                name="bidsParams.BolusCutOffFlag"
                label="Bolus Cut Off Flag"
                hint={BIDS_FIELD_HINTS.BolusCutOffFlag}
                testId="field-bolus-cutoff-flag"
              />
            )}

            {aslType === "PASL" && bolusCutOffFlag && (
              <>
                <BidsSelectField
                  control={control}
                  name="bidsParams.BolusCutOffTechnique"
                  label="Bolus Cut Off Technique"
                  hint={BIDS_FIELD_HINTS.BolusCutOffTechnique}
                  data={["Q2TIPS", "QUIPSS", "QUIPSSII"]}
                  testId="field-bolus-cutoff-technique"
                />
                <BidsCommaNumberField
                  control={control}
                  name="bidsParams.BolusCutOffDelayTime"
                  label="Bolus Cut Off Delay Time"
                  hint={BIDS_FIELD_HINTS.BolusCutOffDelayTime}
                  description="Comma-separated for multiple values. For multi-PLD schemes, place 0 where M0 and/or dummy ASL volumes are found"
                  testId="field-bolus-cutoff-delay"
                />
              </>
            )}

            <BidsCheckboxField
              control={control}
              name="bidsParams.BackgroundSuppression"
              label="Background Suppression"
              hint={BIDS_FIELD_HINTS.BackgroundSuppression}
              testId="field-background-suppression"
            />

            {hasBackgroundSuppression && (
              <>
                <BidsNumberField
                  control={control}
                  name="bidsParams.BackgroundSuppressionNumberPulses"
                  label="Background Suppression Number Pulses"
                  hint={BIDS_FIELD_HINTS.BackgroundSuppressionNumberPulses}
                  min={0}
                  testId="field-bg-suppression-pulses"
                />
                <BidsCommaArrayField
                  control={control}
                  name="bidsParams.BackgroundSuppressionPulseTime"
                  label="Background Suppression Pulse Time"
                  hint={BIDS_FIELD_HINTS.BackgroundSuppressionPulseTime}
                  testId="field-bg-suppression-pulse-time"
                />
              </>
            )}

            <BidsCheckboxField
              control={control}
              name="bidsParams.VascularCrushing"
              label="Vascular Crushing"
              hint={BIDS_FIELD_HINTS.VascularCrushing}
              testId="field-vascular-crushing"
            />

            {mrAcquisitionType === "2D" && (
              <BidsCommaArrayField
                control={control}
                name="bidsParams.SliceTiming"
                label="Slice Timing"
                hint={BIDS_FIELD_HINTS.SliceTiming}
                testId="field-slice-timing"
              />
            )}
          </MetadataSectionCard>

          <Group justify="flex-end">
            <Button variant="default" onClick={onClose} data-testid="modal-cancel-btn">
              Cancel
            </Button>
            <Button type="submit" data-testid="modal-save-btn">
              Save Metadata Group
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

export type { MetadataGroupFormValues };

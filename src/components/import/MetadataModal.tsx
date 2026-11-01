import { zodResolver } from "@hookform/resolvers/zod";
import { Alert, Button, Group, Modal, Stack, TextInput } from "@mantine/core";
import { useEffect, useRef } from "react";
import { useForm, useWatch, type Resolver } from "react-hook-form";

import { stripEmptyBidsParams } from "./metadataFieldHints";
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
import { captureProjectLease, isCurrentProjectLease } from "../../lib/projectLifecycle";

interface MetadataModalProps {
  opened: boolean;
  title: string;
  initialValues: MetadataGroupFormValues;
  onClose: () => void;
  onSubmit: (values: MetadataGroupFormValues) => void | Promise<void>;
}

export default function MetadataModal({
  opened,
  title,
  initialValues,
  onClose,
  onSubmit,
}: MetadataModalProps) {
  const form = useForm<MetadataGroupFormValues>({
    resolver: zodResolver(MetadataGroupFormSchema) as Resolver<MetadataGroupFormValues>,
    defaultValues: initialValues,
  });

  const prevOpenedRef = useRef(opened);
  const prevInitialValuesRef = useRef(initialValues);
  const submitting = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const justOpened = opened && !prevOpenedRef.current;
    const initialValuesChanged = opened && prevInitialValuesRef.current !== initialValues;
    if (
      justOpened ||
      (initialValuesChanged && !form.formState.isDirty && !form.formState.isSubmitting)
    ) {
      form.reset(initialValues);
    }
    prevOpenedRef.current = opened;
    prevInitialValuesRef.current = initialValues;
  }, [opened, initialValues, form]);

  const { control, register, handleSubmit, formState } = form;

  const aslType = useWatch({ control, name: "bidsParams.ArterialSpinLabelingType" });
  const mrAcquisitionType = useWatch({ control, name: "bidsParams.MRAcquisitionType" });
  const hasBackgroundSuppression = useWatch({
    control,
    name: "bidsParams.BackgroundSuppression",
  });
  const bolusCutOffFlag = useWatch({ control, name: "bidsParams.BolusCutOffFlag" });
  const aslContext = useWatch({ control, name: "bidsParams.ASLContext" }) ?? "";
  const hasM0ScanInContext = aslContext
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .includes("m0scan");

  return (
    <Modal
      opened={opened}
      onClose={() => {
        if (!formState.isSubmitting && !submitting.current) onClose();
      }}
      closeOnEscape={!formState.isSubmitting}
      closeOnClickOutside={!formState.isSubmitting}
      withCloseButton={!formState.isSubmitting}
      title={title}
      centered
      size="xl"
      data-testid="metadata-modal"
      attributes={{ close: { "data-testid": "metadata-modal-close" } }}
    >
      <form
        onSubmit={(event) => {
          if (submitting.current) {
            event.preventDefault();
            return;
          }
          void handleSubmit(async (values) => {
            if (submitting.current) return;
            submitting.current = true;
            const lease = captureProjectLease();
            form.clearErrors("root");
            try {
              await onSubmit({
                ...values,
                bidsParams: stripEmptyBidsParams({
                  ...values.bidsParams,
                  M0Type: hasM0ScanInContext ? "Included" : values.bidsParams.M0Type,
                }),
              });
            } catch (error) {
              if (mounted.current && isCurrentProjectLease(lease))
                form.setError("root", {
                  message: error instanceof Error ? error.message : String(error),
                });
            } finally {
              submitting.current = false;
            }
          })(event);
        }}
      >
        <fieldset
          disabled={formState.isSubmitting}
          style={{ border: 0, padding: 0, margin: 0 }}
          data-testid="metadata-form-fields"
        >
          <Stack gap="md">
            {formState.errors.root?.message && (
              <Alert color="red" role="alert" data-testid="metadata-submit-error">
                {formState.errors.root.message}
              </Alert>
            )}
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
                placeholder="m0scan, label, control, label, control"
                testId="field-asl-context"
              />
              {!hasM0ScanInContext && (
                <BidsSelectField
                  control={control}
                  name="bidsParams.M0Type"
                  label="M0 Type"
                  data={["Separate", "Absent", "Estimate"]}
                  testId="field-m0-type"
                />
              )}
              {hasM0ScanInContext && (
                <BidsSelectField
                  control={control}
                  name="bidsParams.M0Type"
                  label="M0 Type"
                  data={["Included"]}
                  testId="field-m0-type"
                />
              )}
              <BidsNumberField
                control={control}
                name="bidsParams.M0_GMScaleFactor"
                label="M0 GM Scale Factor"
                min={0}
                testId="field-m0-gm-scale-factor"
              />
              <BidsCommaArrayField
                control={control}
                name="bidsParams.DummyScanPositionInASL4D"
                label="Dummy Scan Position in ASL4D"
                testId="field-dummy-scan-position"
              />
              <BidsCommaArrayField
                control={control}
                name="bidsParams.RepetitionTimePreparationM0"
                label="Repetition Time Preparation M0"
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
                data={["2D", "3D"]}
                testId="field-mr-acquisition-type"
              />
              <BidsNumberField
                control={control}
                name="bidsParams.MagneticFieldStrength"
                label="Magnetic Field Strength (T)"
                decimalScale={2}
                testId="field-magnetic-field-strength"
              />
              <BidsNumberField
                control={control}
                name="bidsParams.EchoTime"
                label="Echo Time"
                testId="field-echo-time"
              />
              <BidsNumberField
                control={control}
                name="bidsParams.RepetitionTimePreparation"
                label="Repetition Time Preparation"
                testId="field-repetition-time-prep"
              />
              <BidsCommaNumberField
                control={control}
                name="bidsParams.FlipAngle"
                label="Flip Angle"
                testId="field-flip-angle"
              />
            </MetadataSectionCard>

            <MetadataSectionCard title="Core ASL Parameters" testId="metadata-section-core-asl">
              <BidsNumberField
                control={control}
                name="bidsParams.TotalAcquiredPairs"
                label="Total Acquired Control–Label Pairs"
                decimalScale={0}
                min={1}
                testId="field-total-acquired-pairs"
              />
              <BidsSelectField
                control={control}
                name="bidsParams.ArterialSpinLabelingType"
                label="Arterial Spin Labeling Type"
                data={["CASL", "PCASL", "PASL"]}
                testId="field-arterial-spin-labeling-type"
              />
              <BidsCommaNumberField
                control={control}
                name="bidsParams.PostLabelingDelay"
                label="Post Labeling Delay"
                description="Comma-separated for multiple values. For multi-PLD schemes, place 0 where M0 and/or dummy ASL volumes are found"
                testId="field-post-labeling-delay"
              />

              {(aslType === "CASL" || aslType === "PCASL") && (
                <BidsCommaNumberField
                  control={control}
                  name="bidsParams.LabelingDuration"
                  label="Labeling Duration"
                  testId="field-labeling-duration"
                />
              )}

              {aslType === "PCASL" && (
                <BidsSelectField
                  control={control}
                  name="bidsParams.PCASLType"
                  label="PCASL Type"
                  data={["balanced", "unbalanced"]}
                  testId="field-pcasl-type"
                />
              )}

              {aslType === "CASL" && (
                <BidsSelectField
                  control={control}
                  name="bidsParams.CASLType"
                  label="CASL Type"
                  data={["single-coil", "double-coil"]}
                  testId="field-casl-type"
                />
              )}

              {aslType === "PASL" && (
                <BidsCheckboxField
                  control={control}
                  name="bidsParams.BolusCutOffFlag"
                  label="Bolus Cut Off Flag"
                  testId="field-bolus-cutoff-flag"
                />
              )}

              {aslType === "PASL" && bolusCutOffFlag && (
                <>
                  <BidsSelectField
                    control={control}
                    name="bidsParams.BolusCutOffTechnique"
                    label="Bolus Cut Off Technique"
                    data={["Q2TIPS", "QUIPSS", "QUIPSSII"]}
                    testId="field-bolus-cutoff-technique"
                  />
                  <BidsCommaNumberField
                    control={control}
                    name="bidsParams.BolusCutOffDelayTime"
                    label="Bolus Cut Off Delay Time"
                    description="Saturation-pulse timings in seconds, in increasing order. For Q2TIPS, enter the first and last pulse timings, comma-separated."
                    testId="field-bolus-cutoff-delay"
                  />
                </>
              )}

              <BidsCheckboxField
                control={control}
                name="bidsParams.BackgroundSuppression"
                label="Background Suppression"
                testId="field-background-suppression"
              />

              {hasBackgroundSuppression && (
                <>
                  <BidsNumberField
                    control={control}
                    name="bidsParams.BackgroundSuppressionNumberPulses"
                    label="Background Suppression Number Pulses"
                    min={0}
                    testId="field-bg-suppression-pulses"
                  />
                  <BidsCommaArrayField
                    control={control}
                    name="bidsParams.BackgroundSuppressionPulseTime"
                    label="Background Suppression Pulse Time"
                    testId="field-bg-suppression-pulse-time"
                  />
                </>
              )}

              <BidsCheckboxField
                control={control}
                name="bidsParams.VascularCrushing"
                label="Vascular Crushing"
                testId="field-vascular-crushing"
              />

              {mrAcquisitionType === "2D" && (
                <BidsCommaArrayField
                  control={control}
                  name="bidsParams.SliceTiming"
                  label="Slice Timing"
                  testId="field-slice-timing"
                />
              )}
            </MetadataSectionCard>

            <Group justify="flex-end">
              <Button
                variant="default"
                onClick={onClose}
                disabled={formState.isSubmitting}
                data-testid="modal-cancel-btn"
              >
                Cancel
              </Button>
              <Button type="submit" loading={formState.isSubmitting} data-testid="modal-save-btn">
                Save Metadata Group
              </Button>
            </Group>
          </Stack>
        </fieldset>
      </form>
    </Modal>
  );
}

export type { MetadataGroupFormValues };

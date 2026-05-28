import { Button, Checkbox, Group, Modal, NumberInput, Select, Stack, TextInput } from "@mantine/core";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import { BidsAslMetadataSchema } from "../../schemas/importSchemas";

const MetadataGroupFormSchema = z.object({
  label: z.string().trim().min(1, "Label is required"),
  bidsParams: BidsAslMetadataSchema,
});

type MetadataGroupFormValues = z.infer<typeof MetadataGroupFormSchema>;

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
    resolver: zodResolver(MetadataGroupFormSchema),
    defaultValues: initialValues,
    values: initialValues,
  });

  const aslType = form.watch("bidsParams.ArterialSpinLabelingType");
  const hasBackgroundSuppression = form.watch("bidsParams.BackgroundSuppression");

  return (
    <Modal opened={opened} onClose={onClose} title={title} centered size="lg">
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <Stack gap="md">
          <TextInput
            label="Group Label"
            placeholder="Global Defaults"
            {...form.register("label")}
            error={form.formState.errors.label?.message}
          />

          <Controller
            control={form.control}
            name="bidsParams.ArterialSpinLabelingType"
            render={({ field, fieldState }) => (
              <Select
                label="Arterial Spin Labeling Type"
                data={["CASL", "PCASL", "PASL"]}
                value={field.value ?? null}
                onChange={field.onChange}
                error={fieldState.error?.message}
                comboboxProps={{ withinPortal: false }}
              />
            )}
          />

          <Controller
            control={form.control}
            name="bidsParams.MRAcquisitionType"
            render={({ field, fieldState }) => (
              <Select
                label="MR Acquisition Type"
                data={["2D", "3D"]}
                value={field.value ?? null}
                onChange={field.onChange}
                error={fieldState.error?.message}
                comboboxProps={{ withinPortal: false }}
              />
            )}
          />

          <Controller
            control={form.control}
            name="bidsParams.PostLabelingDelay"
            render={({ field, fieldState }) => (
              <NumberInput
                label="Post Labeling Delay"
                value={typeof field.value === "number" ? field.value : ""}
                onChange={(value) =>
                  field.onChange(typeof value === "number" ? value : undefined)
                }
                decimalScale={3}
                error={fieldState.error?.message}
              />
            )}
          />

          {(aslType === "CASL" || aslType === "PCASL") && (
            <Controller
              control={form.control}
              name="bidsParams.LabelingDuration"
              render={({ field, fieldState }) => (
                <NumberInput
                  label="Labeling Duration"
                  value={typeof field.value === "number" ? field.value : ""}
                  onChange={(value) =>
                    field.onChange(typeof value === "number" ? value : undefined)
                  }
                  decimalScale={3}
                  error={fieldState.error?.message}
                />
              )}
            />
          )}

          <Controller
            control={form.control}
            name="bidsParams.BackgroundSuppression"
            render={({ field }) => (
              <Checkbox
                label="Background Suppression"
                checked={field.value ?? false}
                onChange={(event) => field.onChange(event.currentTarget.checked)}
              />
            )}
          />

          {hasBackgroundSuppression && (
            <Controller
              control={form.control}
              name="bidsParams.BackgroundSuppressionNumberPulses"
              render={({ field, fieldState }) => (
                <NumberInput
                  label="Background Suppression Number Pulses"
                  value={typeof field.value === "number" ? field.value : ""}
                  onChange={(value) =>
                    field.onChange(typeof value === "number" ? value : undefined)
                  }
                  min={0}
                  error={fieldState.error?.message}
                />
              )}
            />
          )}

          <Controller
            control={form.control}
            name="bidsParams.Vendor"
            render={({ field, fieldState }) => (
              <Select
                label="Vendor"
                data={["Siemens", "Philips", "GE_product", "GE_WIP"]}
                value={field.value ?? null}
                onChange={field.onChange}
                error={fieldState.error?.message}
                comboboxProps={{ withinPortal: false }}
              />
            )}
          />

          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">Save Metadata Group</Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

export type { MetadataGroupFormValues };

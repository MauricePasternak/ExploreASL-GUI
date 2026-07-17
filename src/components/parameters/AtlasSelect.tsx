import { MultiSelect, Select, NumberInput, Group, Text, Stack } from "@mantine/core";

import {
  ATLAS_OPTIONS,
  ATLAS_DISPLAY_LABELS,
  FIELD_METADATA,
} from "../../lib/dataParFieldMetadata";
import { FieldInfoIcon } from "../common/FieldInfoIcon";

const TISSUE_MASKING_OPTIONS = [
  { value: "GM", label: "GM" },
  { value: "WM", label: "WM" },
  { value: "CSF", label: "CSF" },
  { value: "GM+WM", label: "GM+WM" },
  { value: "GM+WM+CSF", label: "GM+WM+CSF" },
];

const atlasData = [
  {
    group: "Free",
    items: ATLAS_OPTIONS.free.map((val) => ({
      value: val,
      label: ATLAS_DISPLAY_LABELS[val] ?? val,
    })),
  },
  {
    group: "Non-commercial only",
    items: ATLAS_OPTIONS.commercial.map((val) => ({
      value: val,
      label: ATLAS_DISPLAY_LABELS[val] ?? val,
    })),
  },
];

interface AtlasSelectProps {
  atlases: string[];
  tissueMasking: string[];
  tissueThreshold: number[];
  onAtlasesChange: (v: string[]) => void;
  onTissueMaskingChange: (v: string[]) => void;
  onTissueThresholdChange: (v: number[]) => void;
}

export function AtlasSelect({
  atlases,
  tissueMasking,
  tissueThreshold,
  onAtlasesChange,
  onTissueMaskingChange,
  onTissueThresholdChange,
}: AtlasSelectProps) {
  const handleAdd = (added: string) => {
    onAtlasesChange([...atlases, added]);
    const defaultMask = added === "DeepWM" ? "WM" : "GM";
    onTissueMaskingChange([...tissueMasking, defaultMask]);
    onTissueThresholdChange([...tissueThreshold, 0.7]);
  };

  const handleRemove = (removed: string) => {
    const idx = atlases.indexOf(removed);
    if (idx === -1) return;
    onAtlasesChange(atlases.filter((a) => a !== removed));
    onTissueMaskingChange(tissueMasking.filter((_, i) => i !== idx));
    onTissueThresholdChange(tissueThreshold.filter((_, i) => i !== idx));
  };

  const handleChange = (values: string[]) => {
    const added = values.filter((v) => !atlases.includes(v));
    const removed = atlases.filter((v) => !values.includes(v));
    for (const a of added) handleAdd(a);
    for (const r of removed) handleRemove(r);
  };

  const updateMasking = (idx: number, value: string) => {
    const next = [...tissueMasking];
    next[idx] = value;
    onTissueMaskingChange(next);
  };

  const updateThreshold = (idx: number, value: number | string) => {
    const next = [...tissueThreshold];
    next[idx] = typeof value === "number" ? value : parseFloat(value) || 0.7;
    onTissueThresholdChange(next);
  };

  return (
    <Stack gap="sm">
      <MultiSelect
        data={atlasData}
        value={atlases}
        onChange={handleChange}
        placeholder="Select atlases"
        searchable
        data-testid="field-Atlases"
      />
      {atlases.map((atlas, idx) => (
        <Group key={atlas} gap="xs" align="center" wrap="nowrap">
          <Text
            size="sm"
            w={240}
            fw={500}
            style={{ textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}
          >
            {ATLAS_DISPLAY_LABELS[atlas] ?? atlas}
          </Text>
          <Group gap={4} align="center" wrap="nowrap">
            <Select
              data={TISSUE_MASKING_OPTIONS}
              value={tissueMasking[idx] ?? (atlas === "DeepWM" ? "WM" : "GM")}
              onChange={(v) => v && updateMasking(idx, v)}
              placeholder="Tissue masking"
              size="xs"
              w={120}
              data-testid={`field-TissueMasking-${atlas}`}
            />
            <FieldInfoIcon
              tooltipLabel={FIELD_METADATA.TissueMasking.description}
              aria-label={`Info for Tissue Masking (${atlas})`}
            />
          </Group>
          <Group gap={4} align="center" wrap="nowrap">
            <NumberInput
              value={tissueThreshold[idx] ?? 0.7}
              onChange={(v) => updateThreshold(idx, v ?? 0.7)}
              step={0.1}
              min={0}
              max={1}
              size="xs"
              w={100}
              data-testid={`field-TissueThreshold-${atlas}`}
            />
            <FieldInfoIcon
              tooltipLabel={FIELD_METADATA.TissueThreshold.description}
              aria-label={`Info for Tissue Threshold (${atlas})`}
            />
          </Group>
        </Group>
      ))}
    </Stack>
  );
}

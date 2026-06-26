import { Text, Box } from "@mantine/core";

import { FieldInfoIcon } from "../FieldInfoIcon";
import { FIELD_METADATA } from "../../lib/dataParFieldMetadata";

interface DataParFieldLabelProps {
  fieldKey: string;
  label?: string;
  htmlFor?: string;
}

export function DataParFieldLabel({ fieldKey, label, htmlFor }: DataParFieldLabelProps) {
  const meta = FIELD_METADATA[fieldKey];

  if (!meta) {
    const textNode = (
      <Text size="sm" fw={500} span>
        {label ?? fieldKey}
      </Text>
    );
    return htmlFor ? (
      <label htmlFor={htmlFor} style={{ cursor: "pointer" }}>
        {textNode}
      </label>
    ) : (
      textNode
    );
  }

  const labelNode = htmlFor ? (
    <label htmlFor={htmlFor} style={{ cursor: "pointer" }}>
      <Text size="sm" fw={500} span>
        {label ?? meta.label}
      </Text>
    </label>
  ) : (
    <Text size="sm" fw={500} span>
      {label ?? meta.label}
    </Text>
  );

  return (
    <Box
      component="span"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        verticalAlign: "middle",
      }}
    >
      {labelNode}
      <FieldInfoIcon
        tooltipLabel={meta.description}
        aria-label={`Info for ${meta.label}`}
        onClick={(e) => {
          // Prevent clicking the tooltip info icon from toggling the checkbox/switch or focusing text input
          e.preventDefault();
          e.stopPropagation();
        }}
        onMouseDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
      />
    </Box>
  );
}

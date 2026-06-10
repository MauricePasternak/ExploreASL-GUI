import { Group, Text, Box, Tooltip } from "@mantine/core";
import { IconInfoCircle } from "@tabler/icons-react";

import { FIELD_METADATA } from "../../lib/dataParFieldMetadata";

interface DataParFieldLabelProps {
  fieldKey: string;
}

export function DataParFieldLabel({ fieldKey }: DataParFieldLabelProps) {
  const meta = FIELD_METADATA[fieldKey];
  if (!meta) return <Text size="sm" fw={500} span>{fieldKey}</Text>;

  return (
    <Group gap={6} align="center" style={{ display: "inline-flex", verticalAlign: "middle" }}>
      <Text size="sm" fw={500} span>
        {meta.label}
      </Text>
      <Tooltip
        label={meta.description}
        multiline
        w={320}
        withArrow
        withinPortal
        transitionProps={{ duration: 0 }}
        openDelay={0}
        closeDelay={0}
      >
        <Box
          component="span"
          display="inline-flex"
          style={{
            cursor: "pointer",
            alignItems: "center",
            justifyContent: "center",
            width: "18px",
            height: "18px",
            borderRadius: "50%",
            backgroundColor: "#066fd1",
            color: "white",
          }}
        >
          <IconInfoCircle
            size={13}
            stroke={2.5}
            color="white"
            style={{ display: "block" }}
            aria-label={`Info for ${meta.label}`}
            role="img"
          />
        </Box>
      </Tooltip>
    </Group>
  );
}

import { useState } from "react";
import { ActionIcon, Box, Paper, Text } from "@mantine/core";
import { IconHelpCircle } from "@tabler/icons-react";

interface HelpTooltipProps {
  label: string;
  tooltip: string;
}

export default function HelpTooltip({ label, tooltip }: HelpTooltipProps) {
  const [opened, setOpened] = useState(false);

  return (
    <Box
      component="span"
      pos="relative"
      display="inline-flex"
      onMouseEnter={() => setOpened(true)}
      onMouseLeave={() => setOpened(false)}
    >
      <ActionIcon
        aria-label={label}
        variant="subtle"
        color="gray"
        onFocus={() => setOpened(true)}
        onBlur={() => setOpened(false)}
        data-testid="help-tooltip"
      >
        <IconHelpCircle size={16} />
      </ActionIcon>
      {opened ? (
        <Paper
          role="tooltip"
          shadow="sm"
          withBorder
          p="xs"
          w="22rem"
          maw="22rem"
          pos="absolute"
          top="calc(100% + 4px)"
          left={0}
          style={{ zIndex: 10 }}
        >
          <Text size="xs">{tooltip}</Text>
        </Paper>
      ) : null}
    </Box>
  );
}

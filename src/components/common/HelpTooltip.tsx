import { ActionIcon, Tooltip } from "@mantine/core";
import { IconHelpCircle } from "@tabler/icons-react";

interface HelpTooltipProps {
  label: string;
  tooltip: string;
}

export default function HelpTooltip({ label, tooltip }: HelpTooltipProps) {
  return (
    <Tooltip
      label={tooltip}
      events={{ hover: true, focus: true, touch: false }}
      multiline
      w="22rem"
    >
      <ActionIcon
        aria-label={label}
        variant="subtle"
        color="gray"
        data-testid={`help-tooltip-${label}`}
      >
        <IconHelpCircle size={16} />
      </ActionIcon>
    </Tooltip>
  );
}

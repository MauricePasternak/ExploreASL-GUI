import { Tooltip, Group, useMantineColorScheme } from "@mantine/core";
import { IconInfoCircle } from "@tabler/icons-react";
import { type ReactNode } from "react";

interface PremiumTooltipProps {
  label: ReactNode;
  children: ReactNode;
  position?: "bottom" | "top" | "left" | "right";
  withArrow?: boolean;
  hasIcon?: boolean;
  w?: number | string;
}

export function PremiumTooltip({
  label,
  children,
  position = "top",
  withArrow = true,
  hasIcon = true,
  w,
}: PremiumTooltipProps) {
  const { colorScheme } = useMantineColorScheme();
  const isDark = colorScheme === "dark";

  const tooltipBg = isDark ? "var(--mantine-color-dark-6)" : "#fafefe";
  const tooltipColor = isDark ? "var(--mantine-color-dark-0)" : "var(--mantine-color-black)";
  const tooltipBorder = `1px solid ${isDark ? "var(--mantine-color-dark-4)" : "var(--mantine-color-teal-2)"}`;
  const infoIconColor = isDark ? "var(--mantine-color-teal-4)" : "var(--mantine-color-teal-6)";

  const tooltipContent = hasIcon ? (
    <Group gap="xs" align="flex-start" wrap="nowrap" style={{ display: "inline-flex" }}>
      <IconInfoCircle size={16} color={infoIconColor} style={{ marginTop: 2, flexShrink: 0 }} />
      <div
        style={{
          flex: 1,
          fontSize: "var(--mantine-font-size-xs)",
          lineHeight: 1.4,
          whiteSpace: "pre-line",
        }}
      >
        {label}
      </div>
    </Group>
  ) : (
    label
  );

  return (
    <Tooltip
      label={tooltipContent}
      multiline={!!w}
      w={w}
      withArrow={withArrow}
      withinPortal
      transitionProps={{ duration: 0 }}
      openDelay={0}
      closeDelay={0}
      position={position}
      styles={{
        tooltip: {
          backgroundColor: tooltipBg,
          color: tooltipColor,
          border: tooltipBorder,
          boxShadow: "var(--mantine-shadow-md)",
          padding: "8px 12px",
          borderRadius: "var(--mantine-radius-md)",
        },
        arrow: {
          backgroundColor: tooltipBg,
          borderColor: isDark ? "var(--mantine-color-dark-4)" : "var(--mantine-color-teal-2)",
        },
      }}
    >
      {children}
    </Tooltip>
  );
}

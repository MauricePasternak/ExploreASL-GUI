import { IconInfoCircle } from "@tabler/icons-react";
import { forwardRef, type CSSProperties, type MouseEvent, type ReactNode } from "react";

import { PremiumTooltip } from "./PremiumTooltip";

const ICON_SIZE_PX = 18;

const wrapperStyle: CSSProperties = {
  display: "inline-flex",
  cursor: "pointer",
  alignItems: "center",
  justifyContent: "center",
  lineHeight: 0,
  flexShrink: 0,
  verticalAlign: "middle",
};

interface FieldInfoIconProps {
  "aria-label": string;
  tooltipLabel?: ReactNode;
  onClick?: (e: MouseEvent<HTMLSpanElement>) => void;
  onMouseDown?: (e: MouseEvent<HTMLSpanElement>) => void;
}

export const FieldInfoIcon = forwardRef<HTMLSpanElement, FieldInfoIconProps>(function FieldInfoIcon(
  { "aria-label": ariaLabel, tooltipLabel, onClick, onMouseDown },
  ref,
) {
  const iconNode = (
    <span
      ref={ref}
      aria-label={ariaLabel}
      role="img"
      data-testid="field-info-icon"
      onClick={onClick}
      onMouseDown={onMouseDown}
      style={wrapperStyle}
    >
      <IconInfoCircle
        size={ICON_SIZE_PX}
        stroke={2}
        color="#066fd1"
        style={{ display: "block", pointerEvents: "none" }}
      />
    </span>
  );

  if (!tooltipLabel) {
    return iconNode;
  }

  return (
    <PremiumTooltip label={tooltipLabel} w={320}>
      {iconNode}
    </PremiumTooltip>
  );
});

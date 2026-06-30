import { Group, Switch } from "@mantine/core";

import { fromFlag, toFlag } from "../../lib/dataParFlags";
import { DataParFieldLabel } from "./DataParFieldLabel";

export interface FlagToggleProps {
  fieldKey: string;
  value: 0 | 1 | boolean | undefined;
  onChange: (v: 0 | 1) => void;
  defaultValue?: boolean;
  testId?: string;
}

export function FlagToggle({
  fieldKey,
  value,
  onChange,
  defaultValue = false,
  testId,
}: FlagToggleProps) {
  const checked = fromFlag(value, defaultValue);
  const inputId = `switch-${fieldKey}`;

  return (
    <Group gap="xs" align="center" style={{ minHeight: "32px" }}>
      <Switch
        id={inputId}
        checked={checked}
        onChange={() => onChange(toFlag(!checked))}
        data-testid={testId ?? `field-${fieldKey}`}
      />
      <DataParFieldLabel fieldKey={fieldKey} htmlFor={inputId} />
    </Group>
  );
}

import { Group, Switch } from "@mantine/core";

import { fromFlag, toFlag } from "../../lib/dataParFlags";
import { DataParFieldLabel } from "./DataParFieldLabel";
import { PARAMETER_SWITCH_DEFAULTS } from "../../generated/bindings";

export interface FlagToggleProps {
  fieldKey: keyof typeof PARAMETER_SWITCH_DEFAULTS;
  value: 0 | 1 | boolean | undefined;
  onChange: (v: 0 | 1) => void;
  testId?: string;
}

export function FlagToggle({ fieldKey, value, onChange, testId }: FlagToggleProps) {
  const checked = fromFlag(value ?? PARAMETER_SWITCH_DEFAULTS[fieldKey]);
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

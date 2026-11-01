import type { ComponentProps } from "react";

export function segmentedControlTestIds(testId: string) {
  return {
    "data-testid": testId,
    name: testId,
    attributes: {
      label: {
        renderRoot: (props: ComponentProps<"label"> & { htmlFor: string }) => (
          <label
            {...props}
            data-testid={`${testId}-option-${props.htmlFor.slice(testId.length + 1)}`}
          />
        ),
      },
    },
  };
}

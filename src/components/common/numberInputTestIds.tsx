import type { ComponentProps } from "react";

export function numberInputTestIds(testId: string) {
  return {
    "data-testid": testId,
    attributes: {
      control: {
        renderRoot: (props: ComponentProps<"button"> & { "data-direction": string }) => (
          <button {...props} data-testid={`${testId}-step-${props["data-direction"]}`} />
        ),
      },
    },
  };
}

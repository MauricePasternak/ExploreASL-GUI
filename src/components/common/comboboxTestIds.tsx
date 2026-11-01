import type { ComponentProps } from "react";

/** Mantine renders dropdowns in portals, outside the input's test-id scope. */
export function comboboxTestIds(testId: string) {
  return {
    "data-testid": testId,
    attributes: {
      dropdown: { "data-testid": `${testId}-dropdown` },
      options: { "data-testid": `${testId}-listbox` },
      option: {
        renderRoot: (props: ComponentProps<"div"> & { value: string }) => (
          <div {...props} data-testid={`${testId}-option-${props.value}`} />
        ),
      },
    },
    clearButtonProps: { attributes: { root: { "data-testid": `${testId}-clear` } } },
  };
}

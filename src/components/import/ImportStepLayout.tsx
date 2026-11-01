import { Box, Stack } from "@mantine/core";
import { useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ImportNavigationTargetContext } from "./ImportNavigationTargetContext";

export default function ImportStepLayout({
  children,
  navigation,
  testId,
}: {
  children: ReactNode;
  navigation: ReactNode;
  testId: string;
}) {
  const navigationTarget = useContext(ImportNavigationTargetContext);
  const footer = (
    <Box
      py="md"
      className={navigationTarget ? "import-stepper-footer" : undefined}
      style={{ flexShrink: 0, borderTop: "1px solid var(--mantine-color-default-border)" }}
      data-testid={`${testId}-footer`}
    >
      {navigation}
    </Box>
  );

  return (
    <Stack gap={0} h="100%" style={{ minHeight: 0 }} data-testid={testId}>
      <Box
        style={{ flex: 1, minHeight: 0, overflow: "auto" }}
        tabIndex={0}
        role="region"
        aria-label="Import step content"
        data-testid={`${testId}-content`}
      >
        <Stack gap="md" data-testid={`${testId}-body`}>
          {children}
        </Stack>
      </Box>
      {navigationTarget ? createPortal(footer, navigationTarget) : footer}
    </Stack>
  );
}

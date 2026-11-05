import { Box, Stack } from "@mantine/core";
import { useContext, useEffect, useRef, type ReactNode } from "react";
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
  const contentRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const content = contentRef.current;
    const body = bodyRef.current;
    if (!content || !body) return;
    // WebKit can retain an out-of-range offset after content shrinks or the viewport grows.
    const observer = new ResizeObserver(() => {
      const maxScrollTop = Math.max(0, content.scrollHeight - content.clientHeight);
      if (content.scrollTop > maxScrollTop) content.scrollTop = maxScrollTop;
    });
    observer.observe(content);
    observer.observe(body);
    return () => observer.disconnect();
  }, []);

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
    <Stack
      gap={0}
      h="100%"
      style={{ minHeight: 0 }}
      className="dicom-import-step"
      data-testid={testId}
    >
      <Box
        ref={contentRef}
        style={{ flex: 1, minHeight: 0, overflow: "auto" }}
        className="dicom-import-content"
        tabIndex={0}
        role="region"
        aria-label="Import step content"
        data-testid={`${testId}-content`}
      >
        <Stack ref={bodyRef} gap="md" data-testid={`${testId}-body`}>
          {children}
        </Stack>
      </Box>
      {navigationTarget ? createPortal(footer, navigationTarget) : footer}
    </Stack>
  );
}

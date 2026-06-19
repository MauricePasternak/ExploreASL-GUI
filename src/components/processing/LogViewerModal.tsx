import { useRef, useEffect, useState, useMemo } from "react";
import { Alert, Badge, Box, Loader, Modal, Select, Stack } from "@mantine/core";
import { IconAlertCircle } from "@tabler/icons-react";

import type { LogContent } from "../../lib/logViewer";

interface LogLine {
  text: string;
  type: "default" | "error" | "warning";
}

function classifyLine(text: string): LogLine["type"] {
  if (text.includes("ERROR") || text.includes("Error")) return "error";
  if (text.toLowerCase().includes("warning")) return "warning";
  return "default";
}

function splitLogLines(content: string): LogLine[] {
  return content.split("\n").map((text) => ({
    text,
    type: classifyLine(text),
  }));
}

interface RunOption {
  value: string;
  label: string;
  hasError: boolean;
}

interface LogViewerModalProps {
  opened: boolean;
  onClose: () => void;
  logContent: LogContent | null;
  module: "structural" | "asl" | "import" | "population";
  subjectSession: string;
  loading?: boolean;
  error?: string | null;
  runErrorMap?: Record<string, boolean>;
}

export default function LogViewerModal({
  opened,
  onClose,
  logContent,
  module,
  subjectSession,
  loading = false,
  error = null,
  runErrorMap = {},
}: LogViewerModalProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const entries = useMemo(() => {
    if (!logContent) return [];
    return Object.entries(logContent).sort(([a], [b]) => a.localeCompare(b));
  }, [logContent]);

  const runOptions: RunOption[] = useMemo(() => {
    if (module === "structural" || module === "import" || module === "population") {
      const label =
        module === "structural"
          ? "Structural Log"
          : module === "import"
            ? "Import Log"
            : "Population Log";
      return entries.map(([filename]) => ({
        value: filename,
        label,
        hasError: runErrorMap[filename] ?? false,
      }));
    }
    return entries.map(([filename]) => {
      const match = filename.match(/_ASL_(\d+)\.log$/);
      const runNum = match ? match[1] : "1";
      return {
        value: filename,
        label: `Run ${runNum}`,
        hasError: runErrorMap[filename] ?? false,
      };
    });
  }, [entries, module, runErrorMap]);

  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  useEffect(() => {
    if (entries.length > 0) {
      const firstError = runOptions.find((o) => o.hasError);
      setSelectedFile(firstError?.value ?? entries[0]?.[0] ?? null);
    } else {
      setSelectedFile(null);
    }
  }, [entries, runOptions]);

  const currentContent = selectedFile && logContent ? (logContent[selectedFile] ?? "") : "";

  const lines = useMemo(() => splitLogLines(currentContent), [currentContent]);

  const currentHasError = useMemo(() => {
    if (!selectedFile) return false;
    const opt = runOptions.find((o) => o.value === selectedFile);
    return opt?.hasError ?? false;
  }, [selectedFile, runOptions]);

  useEffect(() => {
    if (currentHasError && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [selectedFile, currentHasError]);

  const modalTitle = useMemo(() => {
    const moduleLabel =
      module === "structural"
        ? "Structural"
        : module === "asl"
          ? "ASL"
          : module === "import"
            ? "Import"
            : "Population";
    const errBadge = currentHasError ? (
      <Badge color="red" ml="sm" size="sm" data-testid="log-error-badge">
        ERRORS DETECTED
      </Badge>
    ) : null;

    if (module === "population") {
      return <span>Population Log {errBadge}</span>;
    }

    const [sub, ses] = subjectSession ? subjectSession.split("_") : ["", ""];
    const subLabel = sub || subjectSession;
    const sesLabel = ses ? ` / ses-${ses}` : "";
    return (
      <span>
        {moduleLabel} Log — {subLabel}
        {sesLabel} {errBadge}
      </span>
    );
  }, [module, subjectSession, currentHasError]);

  const showSelect = module === "asl" && entries.length > 1;

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={modalTitle}
      size="85%"
      data-testid="log-viewer-modal"
    >
      <Stack gap="sm">
        {error && (
          <Alert color="red" icon={<IconAlertCircle size={16} />} data-testid="log-error-alert">
            {error}
          </Alert>
        )}
        {loading && !logContent ? (
          <Box
            style={{ display: "flex", justifyContent: "center", padding: 40 }}
            data-testid="log-loading"
          >
            <Loader />
          </Box>
        ) : (
          <>
            {showSelect && (
              <Select
                data={runOptions.map((o) => ({
                  value: o.value,
                  label: o.label,
                }))}
                value={selectedFile}
                onChange={(val) => setSelectedFile(val)}
                renderOption={({ option }) => {
                  const runOpt = runOptions.find((o) => o.value === option.value);
                  return (
                    <span>
                      {option.label}
                      {runOpt?.hasError && (
                        <IconAlertCircle
                          size={14}
                          color="var(--mantine-color-red-6)"
                          style={{ marginLeft: 4, verticalAlign: "middle" }}
                        />
                      )}
                    </span>
                  );
                }}
                data-testid="log-run-select"
              />
            )}
            <Box
              ref={scrollRef}
              style={{
                maxHeight: "70vh",
                overflow: "auto",
                backgroundColor: "var(--mantine-color-gray-0)",
                borderRadius: "var(--mantine-radius-sm)",
                padding: "var(--mantine-spacing-xs)",
              }}
              data-testid="log-content-scroll"
            >
              <pre
                style={{ margin: 0, fontSize: "0.8rem", lineHeight: 1.4 }}
                data-testid="log-content-pre"
              >
                {lines.map((line, i) => (
                  <div
                    key={i}
                    style={
                      line.type === "error"
                        ? {
                            backgroundColor: "var(--mantine-color-red-1)",
                            color: "var(--mantine-color-red-9)",
                            padding: "0 4px",
                            borderRadius: 2,
                          }
                        : line.type === "warning"
                          ? {
                              backgroundColor: "var(--mantine-color-yellow-1)",
                              color: "var(--mantine-color-yellow-9)",
                              padding: "0 4px",
                              borderRadius: 2,
                            }
                          : undefined
                    }
                    data-testid={`log-line-${i}`}
                  >
                    {line.text}
                  </div>
                ))}
              </pre>
            </Box>
          </>
        )}
      </Stack>
    </Modal>
  );
}

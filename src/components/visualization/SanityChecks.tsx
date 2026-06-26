import { Alert, Badge, Stack } from "@mantine/core";
import { IconCheck, IconAlertTriangle } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import { useProjectStore } from "../../stores/projectStore";

interface SanityChecksProps {
  qcbfRelativePath: string;
  externalAbsolutePath: string;
  keys: Array<{ left: string; right: string }>;
  naTokens: string[];
  sheetName: string | null;
  delimiter: string;
  qcbfRowCount: number;
}

interface SanityResult {
  overlapCount: number;
  unmatchedLeftCount: number;
  leftKeysUnique: boolean;
  rightKeysUnique: boolean;
}

export default function SanityChecks({
  qcbfRelativePath,
  externalAbsolutePath,
  keys,
  naTokens,
  sheetName,
  delimiter,
}: SanityChecksProps) {
  const project = useProjectStore((s) => s.project);
  const [result, setResult] = useState<SanityResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Reset result if keys are empty/invalid during render to avoid synchronous effect warnings
  const hasValidKeys = !!project && keys.length > 0 && !keys.some((k) => !k.left || !k.right);
  if (!hasValidKeys && result !== null) {
    setResult(null);
  }

  useEffect(() => {
    if (!hasValidKeys) {
      return;
    }
    let cancelled = false;
    async function runChecks() {
      if (!project) return;
      try {
        const res = await invoke<SanityResult>("check_join_sanity", {
          projectRoot: project.projectMeta.rootPath,
          qcbfRelativePath,
          externalAbsolutePath,
          keys,
          naTokens,
          sheetName,
          delimiter: delimiter === "auto" ? null : delimiter,
        });
        if (!cancelled) {
          setResult(res);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Sanity check failed");
          setResult(null);
        }
      }
    }
    runChecks();
    return () => {
      cancelled = true;
    };
  }, [
    project,
    qcbfRelativePath,
    externalAbsolutePath,
    keys,
    naTokens,
    sheetName,
    delimiter,
    hasValidKeys,
  ]);

  if (error) {
    return (
      <Alert color="red" icon={<IconAlertTriangle size={16} />} data-testid="sanity-error">
        {error}
      </Alert>
    );
  }
  if (!result) return null;

  const allPass = result.overlapCount > 0 && result.leftKeysUnique && result.rightKeysUnique;

  return (
    <Stack data-testid="sanity-checks" gap="xs">
      {allPass && (
        <Badge
          color="green"
          variant="light"
          leftSection={<IconCheck size={12} />}
          data-testid="sanity-pass"
        >
          All checks passed
        </Badge>
      )}
      {result.overlapCount === 0 && (
        <Alert color="red" icon={<IconAlertTriangle size={16} />} data-testid="sanity-no-overlap">
          No matching values between join columns. Check that keys correspond.
        </Alert>
      )}
      {result.unmatchedLeftCount > 0 && (
        <Badge color="yellow" variant="light" data-testid="sanity-unmatched-left">
          {result.unmatchedLeftCount} unmatched qCBF rows (NaN covariates)
        </Badge>
      )}
      {!result.leftKeysUnique && (
        <Alert
          color="yellow"
          icon={<IconAlertTriangle size={16} />}
          data-testid="sanity-left-not-unique"
        >
          Left keys are not unique — rows will be duplicated. Consider adding session/run to the
          join key.
        </Alert>
      )}
      {!result.rightKeysUnique && (
        <Alert
          color="yellow"
          icon={<IconAlertTriangle size={16} />}
          data-testid="sanity-right-not-unique"
        >
          Right keys are not unique — cartesian expansion will occur.
        </Alert>
      )}
    </Stack>
  );
}

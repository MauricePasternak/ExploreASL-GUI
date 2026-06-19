import { useEffect, useMemo, useState } from "react";
import { Alert, List, Stack, Text } from "@mantine/core";
import { IconAlertTriangle, IconInfoCircle } from "@tabler/icons-react";
import { invoke } from "@tauri-apps/api/core";
import { exists } from "@tauri-apps/plugin-fs";

import { useGlobalStore } from "../../stores/globalStore";
import { useProcessingStore } from "../../stores/processingStore";
import { useProjectStore } from "../../stores/projectStore";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PreflightResult {
  errors: string[];
  warnings: string[];
  ready: boolean;
}

interface PreflightCheckProps {
  onResult?: (result: PreflightResult) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function PreflightCheck({ onResult }: PreflightCheckProps) {
  const config = useProcessingStore((s) => s.config);
  const settings = useGlobalStore((s) => s.settings);
  const project = useProjectStore((s) => s.project);

  const [systemCores, setSystemCores] = useState(0);
  const [matlabExists, setMatlabExists] = useState<boolean | null>(null);
  const [exploreAslExists, setExploreAslExists] = useState<boolean | null>(null);
  const [exploreAslHasM, setExploreAslHasM] = useState<boolean | null>(null);
  const [dataParDirExists, setDataParDirExists] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);

  // Query system cores once
  useEffect(() => {
    invoke<number>("get_cpu_cores")
      .then(setSystemCores)
      .catch(() => setSystemCores(0));
  }, []);

  // Check MATLAB executable existence
  useEffect(() => {
    const path = config?.matlabPath;
    if (!path?.trim()) {
      setMatlabExists(false);
      return;
    }
    exists(path)
      .then(setMatlabExists)
      .catch(() => setMatlabExists(false));
  }, [config?.matlabPath]);

  // Check ExploreASL path and ExploreASL.m
  useEffect(() => {
    const path = config?.exploreAslPath ?? settings.exploreAslPath;
    if (!path?.trim()) {
      setExploreAslExists(false);
      setExploreAslHasM(false);
      return;
    }
    Promise.all([exists(path), exists(`${path}/ExploreASL.m`)])
      .then(([dirExists, mExists]) => {
        setExploreAslExists(dirExists);
        setExploreAslHasM(mExists);
      })
      .catch(() => {
        setExploreAslExists(false);
        setExploreAslHasM(false);
      });
  }, [config?.exploreAslPath, settings.exploreAslPath]);

  // Check dataPar.json directory
  useEffect(() => {
    const rootPath = project?.projectMeta.rootPath;
    if (!rootPath) {
      setDataParDirExists(false);
      return;
    }
    const dataParDir = `${rootPath}/derivatives/ExploreASL`;
    exists(dataParDir)
      .then(setDataParDirExists)
      .catch(() => setDataParDirExists(false));
  }, [project?.projectMeta.rootPath]);

  // Track loading state: wait for all async checks to resolve
  useEffect(() => {
    if (
      matlabExists !== null &&
      exploreAslExists !== null &&
      exploreAslHasM !== null &&
      dataParDirExists !== null
    ) {
      setLoading(false);
    }
  }, [matlabExists, exploreAslExists, exploreAslHasM, dataParDirExists]);

  // Compute validation result
  const result = useMemo((): PreflightResult => {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Hard block: subjects selected (not required for population-only runs)
    const populationOnly = config?.modules.length === 1 && config?.modules[0] === "population";
    if (!config?.subjects.length && !populationOnly) {
      errors.push("No subjects selected. Select at least one subject.");
    }

    // Hard block: modules selected
    if (!config?.modules.length) {
      errors.push("No processing modules selected. Select Structural, ASL, or Population.");
    }

    // Hard block: MATLAB path
    if (!config?.matlabPath?.trim()) {
      errors.push("No MATLAB installation configured. Add one in Settings.");
    } else if (matlabExists === false) {
      errors.push(`MATLAB executable not found at "${config.matlabPath}". Check Settings.`);
    }

    // Hard block: ExploreASL path
    const explorePath = config?.exploreAslPath ?? settings.exploreAslPath;
    if (!explorePath?.trim()) {
      errors.push("No ExploreASL path configured. Set it in Settings.");
    } else {
      if (exploreAslExists === false) {
        errors.push(`ExploreASL directory not found at "${explorePath}". Check Settings.`);
      } else if (exploreAslHasM === false) {
        errors.push(
          `ExploreASL.m not found in "${explorePath}". Verify the ExploreASL installation.`,
        );
      }
    }

    // Hard block: worker count
    const workers = config?.workers ?? 0;
    if (workers < 1) {
      errors.push("Worker count must be at least 1.");
    }
    if (systemCores > 0 && workers > systemCores) {
      errors.push(`Worker count (${workers}) exceeds available CPU cores (${systemCores}).`);
    }

    // Hard block: population + workers > 1
    if (config?.modules.includes("population") && workers !== 1) {
      errors.push(
        "Population module requires exactly 1 worker (single-threaded for atlas/group statistics).",
      );
    }

    // Soft warning: worker count exceeds selected subjects
    if (config?.subjects.length && workers > config.subjects.length) {
      warnings.push(
        `Spawning fewer workers (${config.subjects.length}) than configured (${workers}) because only ${config.subjects.length} subject${config.subjects.length > 1 ? "s are" : " is"} selected.`,
      );
    }

    // Soft warning: dataPar.json directory
    if (dataParDirExists === false) {
      warnings.push(
        "derivatives/ExploreASL/ directory does not exist yet. It will be created during processing.",
      );
    }

    return { errors, warnings, ready: errors.length === 0 };
  }, [
    config?.subjects,
    config?.modules,
    config?.matlabPath,
    config?.exploreAslPath,
    config?.workers,
    settings.exploreAslPath,
    systemCores,
    matlabExists,
    exploreAslExists,
    exploreAslHasM,
    dataParDirExists,
  ]);

  // Report result to parent (only after loading completes)
  useEffect(() => {
    if (!loading) {
      onResult?.(result);
    }
  }, [result, onResult, loading]);

  if (!config) return null;

  return (
    <Stack gap="xs" data-testid="preflight-check">
      {/* Hard block errors */}
      {result.errors.length > 0 && (
        <Alert color="red" icon={<IconAlertTriangle size={16} />} data-testid="preflight-errors">
          {result.errors.length === 1 ? (
            <Text size="sm" data-testid="preflight-error-item">
              {result.errors[0]}
            </Text>
          ) : (
            <List size="sm" spacing={4}>
              {result.errors.map((err) => (
                <List.Item key={err} data-testid="preflight-error-item">
                  {err}
                </List.Item>
              ))}
            </List>
          )}
        </Alert>
      )}

      {/* Soft warnings */}
      {result.warnings.length > 0 && (
        <Alert color="yellow" icon={<IconInfoCircle size={16} />} data-testid="preflight-warnings">
          {result.warnings.length === 1 ? (
            <Text size="sm" data-testid="preflight-warning-item">
              {result.warnings[0]}
            </Text>
          ) : (
            <List size="sm" spacing={4}>
              {result.warnings.map((warn) => (
                <List.Item key={warn} data-testid="preflight-warning-item">
                  {warn}
                </List.Item>
              ))}
            </List>
          )}
        </Alert>
      )}

      {/* All clear */}
      {result.ready && result.warnings.length === 0 && (
        <Text size="sm" c="teal" data-testid="preflight-ready">
          All checks passed. Ready to process.
        </Text>
      )}
    </Stack>
  );
}

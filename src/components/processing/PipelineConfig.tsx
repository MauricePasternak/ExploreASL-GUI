import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Checkbox,
  NumberInput,
  Select,
  Stack,
  Text,
} from "@mantine/core";
import { IconAlertTriangle } from "@tabler/icons-react";
import { invoke } from "@tauri-apps/api/core";

import { PROCESSING_MODULES } from "../../schemas/processingSchemas";
import { useGlobalStore } from "../../stores/globalStore";
import { useProcessingStore } from "../../stores/processingStore";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PipelineConfigProps {
  onValidationChange?: (valid: boolean) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const GB_PER_WORKER = 4;
const MAX_DEFAULT_WORKERS = 4;

function calcDefaultWorkers(cores: number, memMb: number): number {
  const memGB = memMb / 1024;
  const workersByMemory = Math.floor(memGB / GB_PER_WORKER);
  return Math.min(workersByMemory, cores, MAX_DEFAULT_WORKERS);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function PipelineConfig({ onValidationChange }: PipelineConfigProps) {
  const settings = useGlobalStore((s) => s.settings);
  const config = useProcessingStore((s) => s.config);
  const setConfig = useProcessingStore((s) => s.setConfig);

  const [systemCores, setSystemCores] = useState(4);
  const [defaultWorkers, setDefaultWorkers] = useState(4);

  useEffect(() => {
    Promise.all([
      invoke<number>("get_cpu_cores"),
      invoke<number>("get_available_memory_mb"),
    ])
      .then(([cores, memMb]) => {
        setSystemCores(cores);
        setDefaultWorkers(calcDefaultWorkers(cores, memMb));
      })
      .catch(() => {
        // Keep defaults if invoke fails
      });
  }, []);

  // Initialize config if null
  useEffect(() => {
    if (!config) {
      setConfig({
        subjects: [],
        modules: [],
        matlabPath: settings.matlabInstallations[0]?.path ?? "",
        exploreAslPath: settings.exploreAslPath,
        workers: defaultWorkers,
        subjectRegexp: "^sub-.*$",
      });
    }
  }, [config, settings, defaultWorkers, setConfig]);

  // MATLAB select options
  const matlabOptions = useMemo(
    () =>
      settings.matlabInstallations.map((inst) => ({
        value: inst.path,
        label: inst.version
          ? `${inst.label} [${inst.version}] — ${inst.path}`
          : `${inst.label} (${inst.path})`,
      })),
    [settings.matlabInstallations],
  );

  const noMatlab = settings.matlabInstallations.length === 0;
  const noExploreAsl = !settings.exploreAslPath?.trim();

  // Validation
  const validationErrors = useMemo(() => {
    const errors: string[] = [];
    if (noMatlab) errors.push("No MATLAB installation configured. Add one in Settings.");
    if (noExploreAsl) errors.push("No ExploreASL path configured. Set it in Settings.");
    const populationOnly =
      config?.modules.length === 1 && config?.modules[0] === "population";
    if (!config?.subjects.length && !populationOnly) errors.push("No subjects selected.");
    if (!config?.modules.length) errors.push("At least one module must be selected.");
    return errors;
  }, [noMatlab, noExploreAsl, config?.subjects, config?.modules]);

  useEffect(() => {
    onValidationChange?.(validationErrors.length === 0);
  }, [validationErrors, onValidationChange]);

  // Handlers
  const handleMatlabChange = useCallback(
    (value: string | null) => {
      if (!config) return;
      setConfig({ ...config, matlabPath: value ?? "" });
    },
    [config, setConfig],
  );

  const handleModuleToggle = useCallback(
    (module: (typeof PROCESSING_MODULES)[number]) => {
      if (!config) return;
      const modules = config.modules.includes(module)
        ? config.modules.filter((m) => m !== module)
        : [...config.modules, module];
      setConfig({ ...config, modules });
    },
    [config, setConfig],
  );

  const handleWorkersChange = useCallback(
    (value: string | number) => {
      if (!config) return;
      const workers = typeof value === "string" ? parseInt(value, 10) : value;
      if (Number.isNaN(workers) || workers < 1) return;
      setConfig({ ...config, workers });
    },
    [config, setConfig],
  );

  if (!config) return null;

  return (
    <Stack gap="md" data-testid="pipeline-config">
      {/* Validation errors */}
      {validationErrors.length > 0 && (
        <Alert
          color="red"
          icon={<IconAlertTriangle size={16} />}
          data-testid="pipeline-validation-errors"
        >
          <Stack gap={2}>
            {validationErrors.map((err) => (
              <Text key={err} size="sm">{err}</Text>
            ))}
          </Stack>
        </Alert>
      )}

      {/* MATLAB version */}
      <Select
        label="MATLAB Version"
        placeholder={noMatlab ? "No MATLAB configured" : "Select MATLAB installation"}
        data={matlabOptions}
        value={config.matlabPath || null}
        onChange={handleMatlabChange}
        disabled={noMatlab}
        nothingFoundMessage="No MATLAB installations found"
        data-testid="matlab-select"
      />

      {/* Modules */}
      <div>
        <Text fw={600} size="sm" mb="xs" data-testid="modules-label">
          Modules
        </Text>
        <Stack gap="xs">
          {PROCESSING_MODULES.filter((m) => m !== "population").map((module) => (
            <Checkbox
              key={module}
              label={module.charAt(0).toUpperCase() + module.slice(1)}
              checked={config.modules.includes(module)}
              onChange={() => handleModuleToggle(module)}
              data-testid={`module-checkbox-${module}`}
            />
          ))}
        </Stack>
      </div>

      {/* Worker count */}
      <NumberInput
        label="Workers"
        description={
          config.subjects.length > 0 && config.workers > config.subjects.length
            ? `Default: ${defaultWorkers} | Max: ${systemCores} cores (capped to ${config.subjects.length} active worker${config.subjects.length > 1 ? "s" : ""} for selected subject${config.subjects.length > 1 ? "s" : ""})`
            : `Default: ${defaultWorkers} | Max: ${systemCores} cores`
        }
        value={config.workers}
        onChange={handleWorkersChange}
        min={1}
        max={systemCores}
        clampBehavior="strict"
        data-testid="worker-count-input"
      />
    </Stack>
  );
}

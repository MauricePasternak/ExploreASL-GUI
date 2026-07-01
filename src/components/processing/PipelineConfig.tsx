import { useCallback, useEffect, useMemo, useState } from "react";
import { Checkbox, NumberInput, Select, Stack, Text, SimpleGrid, Group } from "@mantine/core";
import { invoke } from "@tauri-apps/api/core";

import { FieldInfoIcon } from "../FieldInfoIcon";

import { PROCESSING_MODULES } from "../../schemas/processingSchemas";
import { useGlobalStore } from "../../stores/globalStore";
import { useProcessingStore } from "../../stores/processingStore";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

export default function PipelineConfig() {
  const settings = useGlobalStore((s) => s.settings);
  const config = useProcessingStore((s) => s.config);
  const setConfig = useProcessingStore((s) => s.setConfig);

  const [systemCores, setSystemCores] = useState(4);
  const [defaultWorkers, setDefaultWorkers] = useState(4);

  useEffect(() => {
    Promise.all([invoke<number>("get_cpu_cores"), invoke<number>("get_available_memory_mb")])
      .then(([cores, memMb]) => {
        setSystemCores(cores);
        setDefaultWorkers(calcDefaultWorkers(cores, memMb));
      })
      .catch((err) => {
        console.warn("[PipelineConfig] Failed to query CPU/Memory, keeping defaults:", err);
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
      let modules = config.modules.includes(module)
        ? config.modules.filter((m) => m !== module)
        : [...config.modules, module];

      // If checking structural or asl, uncheck population
      if (modules.includes(module) && (module === "structural" || module === "asl")) {
        modules = modules.filter((m) => m !== "population");
      }

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
      <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="md">
        {/* MATLAB version */}
        <Select
          label={
            <Group gap="xs" align="center" style={{ display: "inline-flex" }}>
              <span>MATLAB Version</span>
              <FieldInfoIcon
                tooltipLabel="Select the installed MATLAB version to use for executing the processing pipeline."
                aria-label="Info for MATLAB Version"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
              />
            </Group>
          }
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
          <Group gap="xs" align="center" mb="xs" style={{ display: "inline-flex" }}>
            <Text fw={600} size="sm" data-testid="modules-label">
              Modules
            </Text>
            <FieldInfoIcon
              tooltipLabel="Select which pipeline modules to run. 'Structural' processes anatomical scans, and 'ASL' processes functional perfusion scans."
              aria-label="Info for Modules"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
            />
          </Group>
          <Stack gap="xs">
            {PROCESSING_MODULES.filter((m) => m !== "population").map((module) => {
              const label =
                module === "asl" ? "ASL" : module.charAt(0).toUpperCase() + module.slice(1);
              return (
                <Checkbox
                  key={module}
                  label={label}
                  checked={config.modules.includes(module)}
                  onChange={() => handleModuleToggle(module)}
                  data-testid={`module-checkbox-${module}`}
                />
              );
            })}
          </Stack>
        </div>

        {/* Worker count */}
        <NumberInput
          label={
            <Group gap="xs" align="center" style={{ display: "inline-flex" }}>
              <span>Workers</span>
              <FieldInfoIcon
                tooltipLabel="Number of parallel workers. Multiple workers allow processing different subject-session datasets simultaneously."
                aria-label="Info for Workers"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
              />
            </Group>
          }
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
      </SimpleGrid>
    </Stack>
  );
}

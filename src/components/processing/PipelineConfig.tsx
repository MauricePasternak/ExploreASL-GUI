import { Checkbox, Group, NumberInput, SimpleGrid, Stack, Text } from "@mantine/core";
import { useCallback, useEffect } from "react";

import { FieldInfoIcon } from "../common/FieldInfoIcon";
import ProfileSelector from "../common/ProfileSelector";

import { PROCESSING_MODULES } from "../../schemas/processingSchemas";
import { useGlobalStore } from "../../stores/globalStore";
import { useProcessingStore } from "../../stores/processingStore";
import { useProcessingEnvironment } from "../../hooks/useProcessingEnvironment";

export default function PipelineConfig() {
  const executionProfiles = useGlobalStore((s) => s.settings.executionProfiles);
  const profileValidationState = useGlobalStore((s) => s.profileValidationState);
  const config = useProcessingStore((s) => s.config);
  const setConfig = useProcessingStore((s) => s.setConfig);

  const { systemCores, defaultWorkers } = useProcessingEnvironment();

  useEffect(() => {
    if (config) return;
    if (defaultWorkers === 0) return;
    const firstValid = executionProfiles.find(
      (profile) => profileValidationState[profile.id]?.valid === true,
    );
    setConfig({
      subjects: [],
      modules: [],
      selectedProfileId: firstValid?.id ?? "",
      workers: defaultWorkers,
    });
  }, [config, executionProfiles, profileValidationState, defaultWorkers, setConfig]);

  useEffect(() => {
    if (!config || config.selectedProfileId) return;
    const firstValid = executionProfiles.find(
      (profile) => profileValidationState[profile.id]?.valid === true,
    );
    if (firstValid) {
      setConfig({ ...config, selectedProfileId: firstValid.id });
    }
  }, [config, executionProfiles, profileValidationState, setConfig]);

  const handleProfileChange = useCallback(
    (profileId: string) => {
      if (!config) return;
      setConfig({ ...config, selectedProfileId: profileId });
    },
    [config, setConfig],
  );

  const handleModuleToggle = useCallback(
    (module: (typeof PROCESSING_MODULES)[number]) => {
      if (!config) return;
      let modules = config.modules.includes(module)
        ? config.modules.filter((m) => m !== module)
        : [...config.modules, module];

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

  const handleRerunBids2LegacyToggle = useCallback(
    (checked: boolean) => {
      if (!config) return;
      setConfig({ ...config, rerunBids2Legacy: checked });
    },
    [config, setConfig],
  );

  if (!config) return null;

  return (
    <Stack gap="md" data-testid="pipeline-config">
      <SimpleGrid
        cols={{ base: 1, sm: 2, md: 3 }}
        spacing="md"
        data-testid="processing-pipeline-config-grid"
      >
        <ProfileSelector
          value={config.selectedProfileId}
          onChange={handleProfileChange}
          disabled={executionProfiles.length === 0}
        />

        <div data-testid="processing-pipeline-config-modules-section">
          <Group gap="xs" align="center" mb="xs" style={{ display: "inline-flex" }}>
            <Text fw={600} size="sm" data-testid="processing-pipeline-config-modules-label">
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

            <Group gap="xs" align="flex-start" mt="xs" wrap="nowrap">
              <Checkbox
                label="Force re-sync between imported/BIDS data and preliminary ExploreASL derivatives"
                styles={{ label: { whiteSpace: "normal", wordBreak: "break-word" } }}
                checked={config.rerunBids2Legacy ?? false}
                onChange={(e) => handleRerunBids2LegacyToggle(e.currentTarget.checked)}
                disabled={!config.modules.includes("structural") && !config.modules.includes("asl")}
                data-testid="rerun-bids2legacy-checkbox"
              />
              <span style={{ marginTop: 2, display: "inline-flex" }}>
                <FieldInfoIcon
                  tooltipLabel="If checked, the app will force a re-synchronization of the raw imported/BIDS data with the initial ExploreASL derivatives. This is necessary if the raw source files (i.e. BIDS folders) have been altered after the initial import."
                  aria-label="Info for rerun BIDS2Legacy"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                />
              </span>
            </Group>
          </Stack>
        </div>

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
          max={systemCores || 4}
          clampBehavior="strict"
          data-testid="worker-count-input"
        />
      </SimpleGrid>
    </Stack>
  );
}

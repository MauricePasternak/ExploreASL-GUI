import { numberInputTestIds } from "../common/numberInputTestIds";
import { Checkbox, Group, NumberInput, SimpleGrid, Stack, Text } from "@mantine/core";
import { useCallback, useEffect } from "react";

import { FieldInfoIcon } from "../common/FieldInfoIcon";
import ProfileSelector from "../common/ProfileSelector";

import { PROCESSING_MODULES } from "../../schemas/processingSchemas";
import { useGlobalStore } from "../../stores/globalStore";
import { useProcessingStore } from "../../stores/processingStore";
import { useProjectStore } from "../../stores/projectStore";
import { useProcessingEnvironment } from "../../hooks/useProcessingEnvironment";

export default function PipelineConfig() {
  const executionProfiles = useGlobalStore((s) => s.settings.executionProfiles);
  const profileValidationState = useGlobalStore((s) => s.profileValidationState);
  const config = useProjectStore((s) => s.project?.uiState.processing?.config);
  const setConfig = useProcessingStore((s) => s.setConfig);

  const { systemCores, defaultWorkers } = useProcessingEnvironment();

  useEffect(() => {
    if (config) return;
    if (defaultWorkers === 0) return;
    const firstValid = executionProfiles.find(
      (profile) => profileValidationState[profile.id]?.valid === true,
    );
    void setConfig(
      (current) =>
        current ?? {
          subjects: [],
          modules: [],
          selectedProfileId: firstValid?.id ?? "",
          workers: defaultWorkers,
        },
    ).catch(() => undefined);
  }, [config, executionProfiles, profileValidationState, defaultWorkers, setConfig]);

  useEffect(() => {
    if (!config || config.selectedProfileId) return;
    const firstValid = executionProfiles.find(
      (profile) => profileValidationState[profile.id]?.valid === true,
    );
    if (firstValid) {
      void setConfig((current) =>
        current!.selectedProfileId ? current! : { ...current!, selectedProfileId: firstValid.id },
      ).catch(() => undefined);
    }
  }, [config, executionProfiles, profileValidationState, setConfig]);

  const handleProfileChange = useCallback(
    (profileId: string) => {
      if (!config) return;
      void setConfig((current) => ({ ...current!, selectedProfileId: profileId })).catch(
        () => undefined,
      );
    },
    [config, setConfig],
  );

  const handleModuleToggle = useCallback(
    (module: (typeof PROCESSING_MODULES)[number]) => {
      if (!config) return;
      void setConfig((current) => {
        let modules = current!.modules.includes(module)
          ? current!.modules.filter((m) => m !== module)
          : [...current!.modules, module];

        if (modules.includes(module) && (module === "structural" || module === "asl")) {
          modules = modules.filter((m) => m !== "population");
        }

        return { ...current!, modules };
      }).catch(() => undefined);
    },
    [config, setConfig],
  );

  const handleWorkersChange = useCallback(
    (value: string | number) => {
      if (!config) return;
      const workers = typeof value === "string" ? parseInt(value, 10) : value;
      if (Number.isNaN(workers) || workers < 1) return;
      void setConfig((current) => ({ ...current!, workers })).catch(() => undefined);
    },
    [config, setConfig],
  );

  const handleRerunBids2LegacyToggle = useCallback(
    (checked: boolean) => {
      if (!config) return;
      void setConfig((current) => ({ ...current!, rerunBids2Legacy: checked })).catch(
        () => undefined,
      );
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
        <div className="processing-profile-field" data-testid="processing-profile-field">
          <ProfileSelector
            value={config.selectedProfileId}
            onChange={handleProfileChange}
            disabled={executionProfiles.length === 0}
          />
        </div>

        <div data-testid="processing-pipeline-config-modules-section">
          <Group gap="xs" align="center" mb="xs" style={{ display: "inline-flex" }}>
            <Text fw={600} size="sm" data-testid="processing-pipeline-config-modules-label">
              What to process
            </Text>
            <FieldInfoIcon
              tooltipLabel="Structural processes anatomy images. ASL processes blood-flow images."
              aria-label="Info for Modules"
              data-testid="pipeline-modules-info"
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

        <div className="processing-workers-field" data-testid="processing-workers-field">
          <NumberInput
            label={
              <Group gap="xs" align="center" style={{ display: "inline-flex" }}>
                <span>Parallel workers</span>
                <FieldInfoIcon
                  tooltipLabel="Workers process different sessions at the same time."
                  aria-label="Info for Workers"
                  data-testid="pipeline-workers-info"
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
            description={`Up to ${systemCores || 4} workers`}
            value={config.workers}
            onChange={handleWorkersChange}
            min={1}
            max={systemCores || 4}
            clampBehavior="strict"
            {...numberInputTestIds("worker-count-input")}
          />
        </div>

        <details className="processing-resync" data-testid="processing-resync-details">
          <summary>
            Source file changes{config.rerunBids2Legacy ? " · Rebuild enabled" : ""}
          </summary>
          <Group gap="xs" align="flex-start" mt="xs" wrap="nowrap">
            <Checkbox
              label="Rebuild converted data from source files"
              styles={{ label: { whiteSpace: "normal", wordBreak: "break-word" } }}
              checked={config.rerunBids2Legacy ?? false}
              onChange={(e) => handleRerunBids2LegacyToggle(e.currentTarget.checked)}
              disabled={!config.modules.includes("structural") && !config.modules.includes("asl")}
              data-testid="rerun-bids2legacy-checkbox"
            />
            <FieldInfoIcon
              tooltipLabel="Use this if source files changed after you set up this project."
              aria-label="Info for rerun BIDS2Legacy"
              data-testid="pipeline-force-resync-info"
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
        </details>
      </SimpleGrid>
    </Stack>
  );
}

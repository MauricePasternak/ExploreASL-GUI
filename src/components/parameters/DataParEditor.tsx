import { useEffect, useCallback, useRef } from "react";
import { Accordion, Switch, Stack, Text, Group } from "@mantine/core";
import { useDataParStore } from "../../stores/dataParStore";
import { useProjectStore } from "../../stores/projectStore";
import type { DataParState } from "../../schemas/dataPar";
import M0Section from "./M0Section";
import QuantificationSection from "./QuantificationSection";
import GeneralSettingsSection from "./GeneralSettingsSection";
import ASLProcessingSection from "./ASLProcessingSection";
import AtlasesSection from "./AtlasesSection";
import StructuralSection from "./StructuralSection";
import EnvironmentSection from "./EnvironmentSection";

export default function DataParEditor() {
  const dataPar = useDataParStore((s) => s.dataPar);
  const showAdvanced = useDataParStore((s) => s.showAdvanced);
  const setDataParField = useDataParStore((s) => s.setDataParField);
  const clearDataParField = useDataParStore((s) => s.clearDataParField);
  const setShowAdvanced = useDataParStore((s) => s.setShowAdvanced);
  const saveToProject = useDataParStore((s) => s.saveToProject);
  const loadDataPar = useDataParStore((s) => s.loadDataPar);
  const project = useProjectStore((s) => s.project);

  // Load from project on mount
  useEffect(() => {
    if (project?.exploreAslConfig?.dataPar) {
      loadDataPar(project.exploreAslConfig.dataPar);
    }
    if (project?.uiState?.showAdvancedParameters) {
      setShowAdvanced(true);
    }
    // only on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced save
  const saveTimeout = useRef<ReturnType<typeof setTimeout>>();
  const debouncedSave = useCallback(() => {
    clearTimeout(saveTimeout.current);
    saveTimeout.current = setTimeout(() => saveToProject(), 500);
  }, [saveToProject]);

  const handleFieldChange = useCallback(
    (field: string, value: unknown) => {
      if (value === undefined) {
        clearDataParField(field as keyof DataParState);
      } else {
        setDataParField(field as keyof DataParState, value);
      }
      debouncedSave();
    },
    [setDataParField, clearDataParField, debouncedSave],
  );

  return (
    <Stack>
      <Group>
        <Text fw={500}>ExploreASL Processing Parameters</Text>
        <Switch
          label="Show advanced parameters"
          checked={showAdvanced}
          onChange={(e) => {
            setShowAdvanced(e.currentTarget.checked);
            debouncedSave();
          }}
          data-testid="advanced-toggle"
        />
      </Group>

      <Accordion multiple defaultValue={["m0"]}>
        <Accordion.Item value="m0">
          <Accordion.Control>M0 Configuration</Accordion.Control>
          <Accordion.Panel>
            <M0Section dataPar={dataPar} onFieldChange={handleFieldChange} />
          </Accordion.Panel>
        </Accordion.Item>

        <Accordion.Item value="quantification">
          <Accordion.Control>Quantification</Accordion.Control>
          <Accordion.Panel>
            <QuantificationSection dataPar={dataPar} onFieldChange={handleFieldChange} />
          </Accordion.Panel>
        </Accordion.Item>

        <Accordion.Item value="general">
          <Accordion.Control>General Settings</Accordion.Control>
          <Accordion.Panel>
            <GeneralSettingsSection dataPar={dataPar} onFieldChange={handleFieldChange} />
          </Accordion.Panel>
        </Accordion.Item>

        <Accordion.Item value="asl">
          <Accordion.Control>ASL Processing</Accordion.Control>
          <Accordion.Panel>
            <ASLProcessingSection dataPar={dataPar} onFieldChange={handleFieldChange} />
          </Accordion.Panel>
        </Accordion.Item>

        <Accordion.Item value="atlases">
          <Accordion.Control>Atlases & Masking</Accordion.Control>
          <Accordion.Panel>
            <AtlasesSection dataPar={dataPar} onFieldChange={handleFieldChange} />
          </Accordion.Panel>
        </Accordion.Item>

        {showAdvanced && (
          <>
            <Accordion.Item value="structural">
              <Accordion.Control>Structural</Accordion.Control>
              <Accordion.Panel>
                <StructuralSection dataPar={dataPar} onFieldChange={handleFieldChange} />
              </Accordion.Panel>
            </Accordion.Item>

            <Accordion.Item value="environment">
              <Accordion.Control>Environment</Accordion.Control>
              <Accordion.Panel>
                <EnvironmentSection dataPar={dataPar} onFieldChange={handleFieldChange} />
              </Accordion.Panel>
            </Accordion.Item>
          </>
        )}
      </Accordion>
    </Stack>
  );
}

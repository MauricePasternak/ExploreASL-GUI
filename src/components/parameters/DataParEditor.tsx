import { Accordion, Alert, Button, Stack, Switch, Text } from "@mantine/core";
import { IconAdjustments, IconAlertTriangle } from "@tabler/icons-react";
import { useCallback } from "react";
import { M0_OPTIONS } from "../../lib/dataParFieldMetadata";
import type { DataParState } from "../../schemas/dataParSchema";
import { DEFAULT_ADVANCED_VISIBILITY, useDataParStore } from "../../stores/dataParStore";
import { useProjectStore } from "../../stores/projectStore";
import { useProcessingStore } from "../../stores/processingStore";
import HeaderCard from "../common/HeaderCard";
import { ASLProcessingSection } from "./ASLProcessingSection";
import { AtlasesSection } from "./AtlasesSection";
import { EnvironmentSection } from "./EnvironmentSection";
import { GeneralSettingsSection } from "./GeneralSettingsSection";
import { M0Section } from "./M0Section";
import { QuantificationSection } from "./QuantificationSection";
import { StructuralSection } from "./StructuralSection";
import "./DataParEditor.css";
import { PARAMETER_SWITCH_DEFAULTS } from "../../generated/bindings";
import { hasMissingParameterSwitches } from "../../lib/dataParDefaults";

function flagState(value: boolean | 0 | 1 | undefined) {
  return value ? "on" : "off";
}

export default function DataParEditor() {
  const accepted = useProjectStore((state) => state.project?.dataPar);
  const drafts = useDataParStore((state) => state.drafts);
  const dataPar = { ...PARAMETER_SWITCH_DEFAULTS, ...accepted, ...drafts } as DataParState;
  const missingSwitches = hasMissingParameterSwitches(accepted);
  const pendingEdits = useProjectStore((state) => state.pendingEdits);
  const saveError = useProjectStore((state) => state.saveError);
  const confirmMissingSwitches = useDataParStore((state) => state.confirmMissingSwitches);
  const advancedVisibility = useProjectStore(
    (state) => state.project?.uiState.datapar?.advancedVisibility ?? DEFAULT_ADVANCED_VISIBILITY,
  );
  const draftErrors = useProjectStore((state) => state.draftErrors);
  const setDataParField = useDataParStore((s) => s.setDataParField);
  const clearDataParField = useDataParStore((s) => s.clearDataParField);
  const setAdvancedVisibility = useDataParStore((s) => s.setAdvancedVisibility);
  const processingPhase = useProcessingStore((s) => s.processingPhase);

  const handleFieldChange = useCallback(
    (field: string, value: unknown) => {
      if (value === undefined) {
        void clearDataParField(field as keyof DataParState).catch(() => undefined);
      } else {
        void setDataParField(field as keyof DataParState, value).catch(() => undefined);
      }
    },
    [setDataParField, clearDataParField],
  );

  const handleAdvancedToggle = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      void setAdvancedVisibility({ showAdvancedSections: e.currentTarget.checked }).catch(
        () => undefined,
      );
    },
    [setAdvancedVisibility],
  );

  return (
    <Stack className="data-par-editor" data-testid="data-par-editor">
      <HeaderCard
        icon={IconAdjustments}
        title="ExploreASL Processing Parameters"
        subtitle="Switches are explicit processing overrides. Other unset fields and displayed hints remain optional."
        color="grape"
        dataTestId="data-par-editor-header"
        rightSection={
          <Switch
            label="Show advanced parameter sections"
            checked={advancedVisibility.showAdvancedSections}
            onChange={handleAdvancedToggle}
            data-testid="advanced-toggle"
          />
        }
      />

      {missingSwitches && (
        <Alert
          color="yellow"
          title="Review proposed switch choices"
          data-testid="datapar-switch-confirmation"
        >
          <Text size="sm" data-testid="datapar-switch-confirmation-help">
            This project has missing switch choices. Displayed On/Off choices are proposed explicit
            overrides, not inherited engine defaults. Review them, then confirm before processing.
            Existing explicit settings are preserved.
          </Text>
          {saveError && (
            <Text c="red" data-testid="datapar-switch-confirmation-error">
              {saveError}
            </Text>
          )}
          <Button
            mt="sm"
            loading={pendingEdits > 0}
            disabled={pendingEdits > 0}
            onClick={() => void confirmMissingSwitches().catch(() => undefined)}
            data-testid="datapar-confirm-switches"
          >
            Confirm missing switch choices
          </Button>
        </Alert>
      )}

      {Object.keys(draftErrors).some((field) => field.startsWith("dataPar.")) && (
        <Alert color="red" data-testid="datapar-draft-error">
          {Object.entries(draftErrors)
            .filter(([field]) => field.startsWith("dataPar."))
            .map(([, message]) => message)
            .join(". ")}
        </Alert>
      )}

      {(["preparing", "running", "finalizing", "cancelling"] as string[]).includes(
        processingPhase,
      ) && (
        <Alert
          color="yellow"
          icon={<IconAlertTriangle size={16} />}
          data-testid="datapar-running-warning"
        >
          <Text size="sm">Processing is running. Changes will take effect on next run.</Text>
        </Alert>
      )}

      <Accordion
        multiple
        defaultValue={[]}
        variant="separated"
        className="datapar-workspace"
        data-testid="datapar-accordion"
      >
        <div className="datapar-column" data-testid="datapar-study-column">
          <Text component="h2" size="sm" fw={600} data-testid="datapar-study-title">
            Study, calibration & atlases
          </Text>
          <Accordion.Item value="generalSettings" data-testid="accordion-item-generalSettings">
            <Accordion.Control
              aria-label="General Settings"
              aria-describedby="datapar-generalSettings-summary"
              data-testid="datapar-generalSettings-toggle"
            >
              <Text fw={500} size="md">
                General Settings
              </Text>
              <Text
                component="span"
                size="xs"
                c="dimmed"
                className="datapar-summary"
                id="datapar-generalSettings-summary"
                data-testid="datapar-generalSettings-summary"
              >
                Quality{" "}
                {dataPar.Quality === undefined ? "unset" : dataPar.Quality === 1 ? "normal" : "low"}{" "}
                · Scanner correction {flagState(dataPar.enableMetadataGroupingCorrection)}
              </Text>
            </Accordion.Control>
            <Accordion.Panel>
              <GeneralSettingsSection
                dataPar={dataPar}
                onFieldChange={handleFieldChange}
                showAdvanced={advancedVisibility.showAdvancedGeneralSettings}
                onToggleAdvanced={() => {
                  void setAdvancedVisibility({
                    showAdvancedGeneralSettings: !advancedVisibility.showAdvancedGeneralSettings,
                  }).catch(() => undefined);
                }}
              />
            </Accordion.Panel>
          </Accordion.Item>

          <Accordion.Item value="m0" data-testid="accordion-item-m0">
            <Accordion.Control
              aria-label="M0 Configuration"
              aria-describedby="datapar-m0-summary"
              data-testid="datapar-m0-toggle"
            >
              <Text fw={500} size="md">
                M0 Configuration
              </Text>
              <Text
                component="span"
                size="xs"
                c="dimmed"
                className="datapar-summary"
                id="datapar-m0-summary"
                data-testid="datapar-m0-summary"
              >
                {typeof dataPar.M0 === "number"
                  ? `M0 scalar ${dataPar.M0}`
                  : (M0_OPTIONS.find((option) => option.value === dataPar.M0)?.label ??
                    dataPar.M0 ??
                    "M0 unset")}{" "}
                · Suppression pulses {dataPar.BackgroundSuppressionNumberPulses ?? "unset"}
              </Text>
            </Accordion.Control>
            <Accordion.Panel>
              <M0Section
                dataPar={dataPar}
                onFieldChange={handleFieldChange}
                showAdvanced={advancedVisibility.showAdvancedM0Params}
                onToggleAdvanced={() => {
                  void setAdvancedVisibility({
                    showAdvancedM0Params: !advancedVisibility.showAdvancedM0Params,
                  }).catch(() => undefined);
                }}
              />
            </Accordion.Panel>
          </Accordion.Item>

          <Accordion.Item value="atlases" data-testid="accordion-item-atlases">
            <Accordion.Control
              aria-label="Atlases"
              aria-describedby="datapar-atlases-summary"
              data-testid="datapar-atlases-toggle"
            >
              <Text fw={500} size="md">
                Atlases
              </Text>
              <Text
                component="span"
                size="xs"
                c="dimmed"
                className="datapar-summary"
                id="datapar-atlases-summary"
                data-testid="datapar-atlases-summary"
              >
                {dataPar.Atlases === undefined
                  ? "Atlases unset"
                  : `${dataPar.Atlases.length} selected`}
              </Text>
            </Accordion.Control>
            <Accordion.Panel>
              <AtlasesSection
                dataPar={dataPar}
                onFieldChange={handleFieldChange}
                showAdvanced={advancedVisibility.showAdvancedAtlases}
                onToggleAdvanced={() => {
                  void setAdvancedVisibility({
                    showAdvancedAtlases: !advancedVisibility.showAdvancedAtlases,
                  }).catch(() => undefined);
                }}
              />
            </Accordion.Panel>
          </Accordion.Item>
        </div>

        <div className="datapar-column" data-testid="datapar-processing-column">
          <Text component="h2" size="sm" fw={600} data-testid="datapar-processing-title">
            Processing & quantification
          </Text>
          <Accordion.Item value="quantification" data-testid="accordion-item-quantification">
            <Accordion.Control
              aria-label="Quantification"
              aria-describedby="datapar-quantification-summary"
              data-testid="datapar-quantification-toggle"
            >
              <Text fw={500} size="md">
                Quantification
              </Text>
              <Text
                component="span"
                size="xs"
                c="dimmed"
                className="datapar-summary"
                id="datapar-quantification-summary"
                data-testid="datapar-quantification-summary"
              >
                {dataPar.nCompartments === undefined
                  ? "Model unset"
                  : `${dataPar.nCompartments} compartment${dataPar.nCompartments === 1 ? "" : "s"}`}{" "}
                · External quantification {flagState(dataPar.bUseExternalQuantification)}
                {dataPar.bUseExternalQuantification && dataPar.ExternalQuantificationType
                  ? ` · ${dataPar.ExternalQuantificationType}`
                  : ""}
              </Text>
            </Accordion.Control>
            <Accordion.Panel>
              <QuantificationSection
                dataPar={dataPar}
                onFieldChange={handleFieldChange}
                showAdvanced={advancedVisibility.showAdvancedQuantification}
                onToggleAdvanced={() => {
                  void setAdvancedVisibility({
                    showAdvancedQuantification: !advancedVisibility.showAdvancedQuantification,
                  }).catch(() => undefined);
                }}
              />
            </Accordion.Panel>
          </Accordion.Item>

          <Accordion.Item value="aslProcessing" data-testid="accordion-item-aslProcessing">
            <Accordion.Control
              aria-label="ASL Processing"
              aria-describedby="datapar-aslProcessing-summary"
              data-testid="datapar-aslProcessing-toggle"
            >
              <Text fw={500} size="md">
                ASL Processing
              </Text>
              <Text
                component="span"
                size="xs"
                c="dimmed"
                className="datapar-summary"
                id="datapar-aslProcessing-summary"
                data-testid="datapar-aslProcessing-summary"
              >
                Motion {flagState(dataPar.motionCorrection)} · TopUp {flagState(dataPar.bTopUp)} ·
                PVC {flagState(dataPar.bPVCNativeSpace)}
              </Text>
            </Accordion.Control>
            <Accordion.Panel>
              <ASLProcessingSection
                dataPar={dataPar}
                onFieldChange={handleFieldChange}
                showAdvanced={advancedVisibility.showAdvancedASLProcessing}
                onToggleAdvanced={() => {
                  void setAdvancedVisibility({
                    showAdvancedASLProcessing: !advancedVisibility.showAdvancedASLProcessing,
                  }).catch(() => undefined);
                }}
              />
            </Accordion.Panel>
          </Accordion.Item>

          {advancedVisibility.showAdvancedSections && (
            <>
              <Accordion.Item value="structural" data-testid="accordion-item-structural">
                <Accordion.Control
                  aria-label="Structural"
                  aria-describedby="datapar-structural-summary"
                  data-testid="datapar-structural-toggle"
                >
                  <Text fw={500} size="md">
                    Structural
                  </Text>
                  <Text
                    component="span"
                    size="xs"
                    c="dimmed"
                    className="datapar-summary"
                    id="datapar-structural-summary"
                    data-testid="datapar-structural-summary"
                  >
                    Longitudinal registration {flagState(dataPar.bRunLongReg)} · DARTEL{" "}
                    {flagState(dataPar.bRunDARTEL)}
                  </Text>
                </Accordion.Control>
                <Accordion.Panel>
                  <StructuralSection dataPar={dataPar} onFieldChange={handleFieldChange} />
                </Accordion.Panel>
              </Accordion.Item>

              <Accordion.Item value="environment" data-testid="accordion-item-environment">
                <Accordion.Control
                  aria-label="Environment"
                  aria-describedby="datapar-environment-summary"
                  data-testid="datapar-environment-toggle"
                >
                  <Text fw={500} size="md">
                    Environment
                  </Text>
                  <Text
                    component="span"
                    size="xs"
                    c="dimmed"
                    className="datapar-summary"
                    id="datapar-environment-summary"
                    data-testid="datapar-environment-summary"
                  >
                    FSL search {flagState(dataPar.bAutomaticallyDetectFSL)} · VABY search flag{" "}
                    {flagState(dataPar.bAutomaticallyDetectVABY)}
                  </Text>
                </Accordion.Control>
                <Accordion.Panel>
                  <EnvironmentSection dataPar={dataPar} onFieldChange={handleFieldChange} />
                </Accordion.Panel>
              </Accordion.Item>
            </>
          )}
        </div>
      </Accordion>
    </Stack>
  );
}

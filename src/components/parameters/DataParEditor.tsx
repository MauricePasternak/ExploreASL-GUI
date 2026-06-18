import { Accordion, Alert, Group, Stack, Switch, Text } from "@mantine/core";
import { IconAlertTriangle } from "@tabler/icons-react";
import { useCallback, useEffect, useRef } from "react";
import type { DataParState } from "../../schemas/dataParSchema";
import { useDataParStore } from "../../stores/dataParStore";
import { useProcessingStore } from "../../stores/processingStore";
import { useProjectStore } from "../../stores/projectStore";
import { ASLProcessingSection } from "./ASLProcessingSection";
import { AtlasesSection } from "./AtlasesSection";
import { EnvironmentSection } from "./EnvironmentSection";
import { GeneralSettingsSection } from "./GeneralSettingsSection";
import { M0Section } from "./M0Section";
import { QuantificationSection } from "./QuantificationSection";
import { StructuralSection } from "./StructuralSection";

export default function DataParEditor() {
	const dataPar = useDataParStore((s) => s.dataPar);
	const advancedVisibility = useDataParStore((s) => s.advancedVisibility);
	const setDataParField = useDataParStore((s) => s.setDataParField);
	const clearDataParField = useDataParStore((s) => s.clearDataParField);
	const setAdvancedVisibility = useDataParStore((s) => s.setAdvancedVisibility);
	const saveToProject = useDataParStore((s) => s.saveToProject);
	const loadDataPar = useDataParStore((s) => s.loadDataPar);
	const project = useProjectStore((s) => s.project);
	const processingPhase = useProcessingStore((s) => s.processingPhase);

	// Load from project on mount
	useEffect(() => {
		if (project?.exploreAslConfig?.dataPar) {
			loadDataPar(project.exploreAslConfig.dataPar as DataParState);
		}
		if (project?.uiState?.datapar?.advancedVisibility) {
			setAdvancedVisibility(project.uiState.datapar.advancedVisibility);
		}
	}, []); // eslint-disable-line react-hooks/exhaustive-deps

	// Debounced save to project
	const saveTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const debouncedSave = useCallback(() => {
		clearTimeout(saveTimeout.current);
		saveTimeout.current = setTimeout(() => saveToProject(), 500);
	}, [saveToProject]);

	// Cleanup timeout on unmount
	useEffect(() => {
		return () => clearTimeout(saveTimeout.current);
	}, []);

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

	const handleAdvancedToggle = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			setAdvancedVisibility({ showAdvancedSections: e.currentTarget.checked });
			debouncedSave();
		},
		[setAdvancedVisibility, debouncedSave],
	);

	return (
		<Stack p="md" data-testid="data-par-editor">
			<Group justify="space-between">
				<Text fw={500} size="xl">
					ExploreASL Processing Parameters
				</Text>
				<Switch
					label="Show advanced parameters"
					checked={advancedVisibility.showAdvancedSections}
					onChange={handleAdvancedToggle}
					data-testid="advanced-toggle"
				/>
			</Group>

			{(processingPhase === "running" || processingPhase === "preparing") && (
				<Alert
					color="yellow"
					icon={<IconAlertTriangle size={16} />}
					data-testid="datapar-running-warning"
				>
					<Text size="sm">
						Processing is running. Changes will take effect on next run.
					</Text>
				</Alert>
			)}

			<Accordion multiple defaultValue={[]} variant="separated">
				<Accordion.Item value="generalSettings" data-testid="accordion-item-generalSettings">
					<Accordion.Control>
						<Text fw={500} size="md">
							General Settings
						</Text>
					</Accordion.Control>
					<Accordion.Panel>
						<GeneralSettingsSection
							dataPar={dataPar}
							onFieldChange={handleFieldChange}
							showAdvanced={advancedVisibility.showAdvancedGeneralSettings}
							onToggleAdvanced={() => {
								setAdvancedVisibility({ showAdvancedGeneralSettings: !advancedVisibility.showAdvancedGeneralSettings });
								debouncedSave();
							}}
						/>
					</Accordion.Panel>
				</Accordion.Item>

				<Accordion.Item value="m0" data-testid="accordion-item-m0">
					<Accordion.Control>
						<Text fw={500} size="md">
							M0 Configuration
						</Text>
					</Accordion.Control>
					<Accordion.Panel>
						<M0Section
							dataPar={dataPar}
							onFieldChange={handleFieldChange}
							showAdvanced={advancedVisibility.showAdvancedM0Params}
							onToggleAdvanced={() => {
								setAdvancedVisibility({ showAdvancedM0Params: !advancedVisibility.showAdvancedM0Params });
								debouncedSave();
							}}
						/>
					</Accordion.Panel>
				</Accordion.Item>

				<Accordion.Item value="quantification" data-testid="accordion-item-quantification">
					<Accordion.Control>
						<Text fw={500} size="md">
							Quantification
						</Text>
					</Accordion.Control>
					<Accordion.Panel>
						<QuantificationSection
							dataPar={dataPar}
							onFieldChange={handleFieldChange}
							showAdvanced={advancedVisibility.showAdvancedQuantification}
							onToggleAdvanced={() => {
								setAdvancedVisibility({ showAdvancedQuantification: !advancedVisibility.showAdvancedQuantification });
								debouncedSave();
							}}
						/>
					</Accordion.Panel>
				</Accordion.Item>

				<Accordion.Item value="aslProcessing" data-testid="accordion-item-aslProcessing">
					<Accordion.Control>
						<Text fw={500} size="md">
							ASL Processing
						</Text>
					</Accordion.Control>
					<Accordion.Panel>
						<ASLProcessingSection
							dataPar={dataPar}
							onFieldChange={handleFieldChange}
							showAdvanced={advancedVisibility.showAdvancedASLProcessing}
							onToggleAdvanced={() => {
								setAdvancedVisibility({ showAdvancedASLProcessing: !advancedVisibility.showAdvancedASLProcessing });
								debouncedSave();
							}}
						/>
					</Accordion.Panel>
				</Accordion.Item>

				<Accordion.Item value="atlases" data-testid="accordion-item-atlases">
					<Accordion.Control>
						<Text fw={500} size="md">
							Atlases
						</Text>
					</Accordion.Control>
					<Accordion.Panel>
						<AtlasesSection
							dataPar={dataPar}
							onFieldChange={handleFieldChange}
							showAdvanced={advancedVisibility.showAdvancedAtlases}
							onToggleAdvanced={() => {
								setAdvancedVisibility({ showAdvancedAtlases: !advancedVisibility.showAdvancedAtlases });
								debouncedSave();
							}}
						/>
					</Accordion.Panel>
				</Accordion.Item>

				{advancedVisibility.showAdvancedSections && (
					<>
						<Accordion.Item value="structural" data-testid="accordion-item-structural">
							<Accordion.Control>
								<Text fw={500} size="md">
									Structural
								</Text>
							</Accordion.Control>
							<Accordion.Panel>
								<StructuralSection dataPar={dataPar} onFieldChange={handleFieldChange} />
							</Accordion.Panel>
						</Accordion.Item>

						<Accordion.Item value="environment" data-testid="accordion-item-environment">
							<Accordion.Control>
								<Text fw={500} size="md">
									Environment
								</Text>
							</Accordion.Control>
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

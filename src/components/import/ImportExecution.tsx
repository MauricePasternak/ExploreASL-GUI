import { Alert, Badge, Button, Group, Modal, Paper, Select, Stack, Text, Title } from "@mantine/core";
import { IconAlertTriangle, IconArrowLeft, IconCopy, IconPlayerPlay, IconPlayerStop } from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Virtuoso } from "react-virtuoso";

import {
	runImportPipeline,
	setupImportListeners,
	stopImportProcess,
} from "../../lib/importEvents";
import { buildAllStagingMappings } from "../../lib/importPreviewUtils";
import { computeStaleness } from "../../lib/importStaleness";
import { readImportStatus } from "../../lib/importStatus";
import { assembleSourcestructure, assembleStudyPar } from "../../lib/tokenizerUtils";
import { useGlobalStore } from "../../stores/globalStore";
import { type ImportPhase, useImportStore } from "../../stores/importStore";
import { useProjectStore } from "../../stores/projectStore";
import ImportSubjectTable from "./ImportSubjectTable";

const PHASE_META: Record<ImportPhase, { label: string; color: string; variant?: "light" | "filled" }> = {
	idle: { label: "Idle", color: "gray" },
	preparing: { label: "Preparing", color: "blue" },
	running: { label: "Running", color: "blue", variant: "filled" },
	completed: { label: "Completed", color: "green" },
	failed: { label: "Failed", color: "red" },
	cancelled: { label: "Cancelled", color: "orange" },
};

function ImportExecutionHeader({ phase }: { phase: ImportPhase }) {
	const meta = PHASE_META[phase];

	return (
		<Group justify="space-between" align="flex-start" data-testid="import-execution-header">
			<div>
				<Title order={3}>Run Import Module</Title>
				<Text c="dimmed" size="sm">
					Execute the ExploreASL import module and track per-subject progress.
				</Text>
			</div>
			<Badge
				color={meta.color}
				variant={meta.variant ?? "light"}
				size="lg"
				style={phase === "running" ? { boxShadow: "0 0 0 3px var(--mantine-color-blue-light)" } : undefined}
			>
				{meta.label}
			</Badge>
		</Group>
	);
}

function ImportExecutionControls({
	phase,
	canRun,
	onStart,
	onStop,
	noMatlab,
	matlabOptions,
	selectedMatlabPath,
	onMatlabChange,
	hasSelectedSubjects,
}: {
	phase: ImportPhase;
	canRun: boolean;
	onStart: () => void;
	onStop: () => void;
	noMatlab: boolean;
	matlabOptions: { value: string; label: string }[];
	selectedMatlabPath: string | null;
	onMatlabChange: (value: string | null) => void;
	hasSelectedSubjects: boolean;
}) {
	return (
		<Group align="flex-end" data-testid="import-execution-controls">
			<Select
				label="MATLAB Version"
				placeholder={noMatlab ? "No MATLAB configured" : "Select MATLAB installation"}
				data={matlabOptions}
				value={selectedMatlabPath}
				onChange={onMatlabChange}
				disabled={noMatlab || phase === "running"}
				nothingFoundMessage="No MATLAB installations found"
				data-testid="matlab-select"
				w={320}
			/>
			<Button
				leftSection={<IconPlayerPlay size={16} />}
				disabled={phase === "running" || !canRun || !hasSelectedSubjects || noMatlab}
				onClick={onStart}
				data-testid="start-import-btn"
			>
				Start Import
			</Button>
			<Button
				leftSection={<IconPlayerStop size={16} />}
				color="red"
				variant="light"
				disabled={phase !== "running"}
				onClick={onStop}
				data-testid="stop-import-btn"
			>
				Stop
			</Button>
			{noMatlab ? (
				<Alert color="red" icon={<IconAlertTriangle size={16} />} p="xs" data-testid="no-matlab-alert">
					<Text size="sm">No MATLAB installation configured. Add one in Settings.</Text>
				</Alert>
			) : null}
		</Group>
	);
}

function ImportLogPanel({ lines }: { lines: string[] }) {
	const [copied, setCopied] = useState(false);

	const handleCopy = useCallback(async () => {
		const text = lines.join("\n");
		try {
			const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
			await writeText(text);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch {
			await navigator.clipboard.writeText(text);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		}
	}, [lines]);

	if (lines.length === 0) {
		return (
			<Paper withBorder p="md" data-testid="import-log-empty">
				<Stack gap="xs">
					<Group justify="space-between">
						<Text fw={600}>Import log</Text>
						<Button variant="subtle" size="compact-sm" leftSection={<IconCopy size={14} />} disabled>
							Copy
						</Button>
					</Group>
					<Text c="dimmed" size="sm">
						Waiting for import output...
					</Text>
				</Stack>
			</Paper>
		);
	}

	return (
		<Paper withBorder p="md" data-testid="import-log-panel">
			<Stack gap="xs">
				<Group justify="space-between">
					<Text fw={600}>Import log</Text>
					<Button variant="subtle" size="compact-sm" leftSection={<IconCopy size={14} />} onClick={handleCopy}>
						{copied ? "Copied" : "Copy"}
					</Button>
				</Group>
				<div style={{ height: 300 }}>
					<Virtuoso
						data={lines}
						followOutput="smooth"
						itemContent={(_index, line) => (
							<div
								style={{
									fontFamily: "var(--mantine-font-family-monospace)",
									fontSize: "var(--mantine-font-size-xs)",
									lineHeight: 1.4,
									whiteSpace: "pre",
									minHeight: "1.4em",
								}}
							>
								{line || "\u00A0"}
							</div>
						)}
					/>
				</div>
			</Stack>
		</Paper>
	);
}

function ConfirmReimportDialog({
	opened,
	onClose,
	onConfirm,
	subjects,
}: {
	opened: boolean;
	onClose: () => void;
	onConfirm: () => void;
	subjects: string[];
}) {
	return (
		<Modal opened={opened} onClose={onClose} title="Re-import completed subject?" data-testid="confirm-reimport-dialog">
			<Text size="sm">
				The following subjects appear to have completed successfully. Re-importing will overwrite their existing output.
			</Text>
			<ul>
				{subjects.map((subject) => (
					<li key={subject}>{subject}</li>
				))}
			</ul>
			<Group justify="flex-end" mt="md">
				<Button variant="default" onClick={onClose} data-testid="confirm-reimport-cancel">
					Cancel
				</Button>
				<Button color="orange" onClick={onConfirm} data-testid="confirm-reimport-confirm">
					Re-import anyway
				</Button>
			</Group>
		</Modal>
	);
}

export default function ImportExecution() {
	const navigate = useNavigate();
	const importPhase = useImportStore((state) => state.importPhase);
	const importProgress = useImportStore((state) => state.importProgress);
	const importLog = useImportStore((state) => state.importLog);
	const subjectRows = useImportStore((state) => state.subjectRows);
	const selectedMatlabPath = useImportStore((state) => state.selectedMatlabPath);
	const setSelectedMatlabPath = useImportStore((state) => state.setSelectedMatlabPath);
	const setActiveStep = useImportStore((state) => state.setActiveStep);
	const startImport = useImportStore((state) => state.startImport);
	const cancelImportAction = useImportStore((state) => state.cancelImport);
	const resetImportPhase = useImportStore((state) => state.resetImportPhase);
	const addLogLine = useImportStore((state) => state.addLogLine);
	const failImport = useImportStore((state) => state.failImport);
	const settings = useGlobalStore((state) => state.settings);
	const backLocked = importPhase === "running";
	const progressRows = Object.values(importProgress).sort((left, right) => left.subject.localeCompare(right.subject));
	const hasMatlab = settings.matlabInstallations.some((installation) => installation.path.trim().length > 0);
	const hasExploreAsl = settings.exploreAslPath.trim().length > 0;
	const hasSubjects = subjectRows.length > 0;
	const canRun = hasMatlab && hasExploreAsl && hasSubjects;
	const noMatlab = settings.matlabInstallations.length === 0;

	const [selectedSubjects, setSelectedSubjects] = useState<string[]>([]);
	const [confirmSubjects, setConfirmSubjects] = useState<string[] | null>(null);

	const matlabOptions = useMemo(
		() =>
			settings.matlabInstallations.map((inst) => ({
				value: inst.path,
				label: inst.version ? `${inst.label} [${inst.version}] — ${inst.path}` : `${inst.label} (${inst.path})`,
			})),
		[settings.matlabInstallations],
	);

	useEffect(() => {
		if (!selectedMatlabPath && settings.matlabInstallations.length > 0) {
			setSelectedMatlabPath(settings.matlabInstallations[0].path);
		}
	}, [selectedMatlabPath, settings.matlabInstallations, setSelectedMatlabPath]);

	useEffect(() => {
		const subjects = Object.values(importProgress);
		if (subjects.length === 0) return;

		if (importPhase === "idle" || importPhase === "failed" || importPhase === "cancelled") {
			const hasCompleted = subjects.some((s) => s.status === "completed");

			if (!hasCompleted) {
				setSelectedSubjects(subjects.map((s) => s.subject));
			} else {
				const toSelect = subjects
					.filter(
						(s) =>
							s.stale ||
							s.status === "failed" ||
							s.status === "pending" ||
							s.status === "running" ||
							s.status === "cancelled",
					)
					.map((s) => s.subject);
				setSelectedSubjects(toSelect.length > 0 ? toSelect : subjects.map((s) => s.subject));
			}
		}
	}, [importProgress, importPhase]);

	const pidRef = useRef<number | null>(null);
	const cleanupRef = useRef<(() => void) | null>(null);
	const isMountedRef = useRef(true);

	useEffect(() => {
		isMountedRef.current = true;
		return () => {
			isMountedRef.current = false;
		};
	}, []);

	useEffect(() => {
		return () => {
			cleanupRef.current?.();
			cleanupRef.current = null;
		};
	}, []);

	useEffect(() => {
		if (importPhase === "running" || importPhase === "preparing") {
			return;
		}

		let cancelled = false;
		const projectRoot = useProjectStore.getState().project?.projectMeta.rootPath;
		if (!projectRoot) return;

		const store = useImportStore.getState();
		const subjects = [...new Set(store.subjectRows.map((r) => r.subject))];
		if (subjects.length === 0) return;

		readImportStatus(projectRoot)
			.then((statuses) => {
				if (cancelled) return;
				const currentStore = useImportStore.getState();
				if (currentStore.importPhase === "running" || currentStore.importPhase === "preparing") return;
				const staleness = computeStaleness(currentStore, currentStore.mostRecentConfig);
				currentStore.reconstructProgressFromLockFiles(statuses, subjects, staleness);
			})
			.catch(() => {
				// Silently fail — stale reconstruction is best-effort
			});
		return () => {
			cancelled = true;
		};
	}, [importPhase]);

	const doRunImport = useCallback(
		async (subjectsToImport: string[]) => {
			const previousPhase = importPhase;

			const allProgress = Object.values(useImportStore.getState().importProgress);
			const succeededForRetry = allProgress
				.filter((progress) => progress.status === "completed" && !subjectsToImport.includes(progress.subject))
				.map((progress) => progress.subject);

			if (previousPhase === "failed" || previousPhase === "cancelled") {
				resetImportPhase();
			}
			startImport();

			const projectRoot = useProjectStore.getState().project?.projectMeta.rootPath ?? "";
			const stagingRoot = `${projectRoot}/.easl_staging`;

			cleanupRef.current?.();
			cleanupRef.current = null;

			try {
				const cleanup = await setupImportListeners(stagingRoot, projectRoot, subjectsToImport);
				if (!isMountedRef.current) {
					cleanup();
					return;
				}
				cleanupRef.current = cleanup;
			} catch (err) {
				const message = err instanceof Error ? err.message : "Failed to set up import listeners";
				addLogLine(message);
				failImport();
				return;
			}

			try {
				const store = useImportStore.getState();
				const globalSettings = useGlobalStore.getState().settings;

				const subjectRenamesMap = Object.fromEntries(store.subjectRenames.map((r) => [r.original, r.target]));
				const mappings = buildAllStagingMappings(
					store.rawPaths,
					store.sourceDataPath,
					store.pathPatterns,
					store.tokenizerConfigs,
					subjectRenamesMap,
					store.sessionAliases,
					store.modalityAliases,
					globalSettings.tokenSubDelimiters,
				);
				const stagingEntries = mappings.flatMap((m) => m.entries);

				const sourcestructureJson = assembleSourcestructure(
					store.sessionAliases,
					store.runAliases,
					store.modalityAliases,
					store.bMatchDirectories,
				) as Record<string, unknown>;

				const studyparJson = assembleStudyPar(store.metadataGroups, store.subjectRows) as Record<string, unknown>;

				const matlabPath = store.selectedMatlabPath || (globalSettings.matlabInstallations[0]?.path ?? "");
				const exploreaslPath = globalSettings.exploreAslPath;
				const subjectList = subjectsToImport;

				if (succeededForRetry.length > 0) {
					addLogLine(
						`Preserving lock files for previously-completed subjects: ${succeededForRetry.join(", ")}`,
					);
				}

				const pid = await runImportPipeline({
					projectRoot,
					stagingEntries,
					sourcestructureJson,
					studyparJson,
					matlabPath,
					exploreaslPath,
					subjectList,
					subjectsToPreserve:
						succeededForRetry.length > 0 ? succeededForRetry : undefined,
				});

				pidRef.current = pid;
			} catch (err) {
				const message = err instanceof Error ? err.message : "Failed to start import";
				addLogLine(message);
				failImport();
			}
		},
		[importPhase, resetImportPhase, startImport, addLogLine, failImport],
	);

	const handleStartImport = useCallback(() => {
		const progress = useImportStore.getState().importProgress;
		const subjectsToImport =
			selectedSubjects.length > 0
				? selectedSubjects
				: [...new Set(useImportStore.getState().subjectRows.map((r) => r.subject))];

		const freshlyCompleted = subjectsToImport.filter(
			(s) => progress[s]?.status === "completed" && progress[s]?.stale !== true,
		);

		if (freshlyCompleted.length > 0) {
			setConfirmSubjects(freshlyCompleted);
		} else {
			void doRunImport(subjectsToImport);
		}
	}, [selectedSubjects, doRunImport]);

	const handleConfirmReimport = useCallback(() => {
		setConfirmSubjects(null);
		const subjectsToImport =
			selectedSubjects.length > 0
				? selectedSubjects
				: [...new Set(useImportStore.getState().subjectRows.map((r) => r.subject))];
		void doRunImport(subjectsToImport);
	}, [selectedSubjects, doRunImport]);

	const handleCancelReimport = useCallback(() => {
		setConfirmSubjects(null);
	}, []);

	const handleStop = useCallback(() => {
		if (pidRef.current !== null) {
			void stopImportProcess(pidRef.current).catch(() => {});
			pidRef.current = null;
		}
		cancelImportAction();
	}, [cancelImportAction]);

	const advanceToParameters = () => {
		const project = useProjectStore.getState().project;
		if (project) {
			useProjectStore.getState().setPhase("parameters");
			void useProjectStore.getState().saveProject();
			navigate(`/project/${project.projectMeta.id}/parameters`);
		}
	};

	return (
		<Stack gap="md" data-testid="import-execution">
			<ImportExecutionHeader phase={importPhase} />

			<ImportExecutionControls
				phase={importPhase}
				canRun={canRun}
				onStart={handleStartImport}
				onStop={handleStop}
				noMatlab={noMatlab}
				matlabOptions={matlabOptions}
				selectedMatlabPath={selectedMatlabPath || null}
				onMatlabChange={(value) => {
					if (value !== null) {
						setSelectedMatlabPath(value);
					}
				}}
				hasSelectedSubjects={
					selectedSubjects.length > 0 || (Object.keys(importProgress).length === 0 && subjectRows.length > 0)
				}
			/>

			{!canRun ? (
				<Text c="dimmed" size="sm">
					{hasMatlab && hasExploreAsl
						? "Stage at least one subject before running import."
						: "Configure MATLAB and ExploreASL paths in settings before running import."}
				</Text>
			) : null}

			{subjectRows.length === 0 ? (
				<Paper withBorder p="md">
					<Text c="dimmed" size="sm">
						No subjects are staged for import yet.
					</Text>
				</Paper>
			) : null}

			<ImportSubjectTable
				rows={progressRows}
				selectedSubjects={selectedSubjects}
				onSelectedSubjectsChange={setSelectedSubjects}
			/>
			<ImportLogPanel lines={importLog} />

			<ConfirmReimportDialog
				opened={confirmSubjects !== null}
				onClose={handleCancelReimport}
				onConfirm={handleConfirmReimport}
				subjects={confirmSubjects ?? []}
			/>

			<Group justify="space-between">
				<Button
					leftSection={<IconArrowLeft size={16} />}
					variant="light"
					disabled={backLocked}
					onClick={() => setActiveStep(4)}
					data-testid="import-back-btn"
				>
					Back: Preview
				</Button>
				<Button onClick={advanceToParameters} disabled={importPhase === "running"} data-testid="import-next-params-btn">
					Next: Parameters
				</Button>
			</Group>
		</Stack>
	);
}

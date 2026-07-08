import { useEffect, useMemo, useState } from "react";
import { Alert, List, Text } from "@mantine/core";
import {
  IconAlertTriangle,
  IconCircleCheck,
  IconInfoCircle,
  IconLoader,
  IconCircleMinus,
} from "@tabler/icons-react";
import { invoke } from "@tauri-apps/api/core";
import { exists } from "@tauri-apps/plugin-fs";

import { useGlobalStore } from "../../stores/globalStore";
import { useProcessingStore } from "../../stores/processingStore";
import { useProjectStore } from "../../stores/projectStore";

export interface PreflightResult {
  errors: string[];
  warnings: string[];
  ready: boolean;
}

type AlertState = "idle" | "checking" | "error" | "warning" | "ready";

interface ProcessingStatusAlertProps {
  onResult?: (result: PreflightResult) => void;
}

export default function ProcessingStatusAlert({ onResult }: ProcessingStatusAlertProps) {
  const config = useProcessingStore((s) => s.config);
  const executionProfiles = useGlobalStore((s) => s.settings.executionProfiles);
  const profileValidationState = useGlobalStore((s) => s.profileValidationState);
  const hasValidProfile = useGlobalStore((s) => s.hasValidProfile);
  const getProfileById = useGlobalStore((s) => s.getProfileById);
  const project = useProjectStore((s) => s.project);
  const availableSubjects = useProcessingStore((s) => s.availableSubjects);
  const subjectStatuses = useProcessingStore((s) => s.subjectStatuses);

  const [systemCores, setSystemCores] = useState(0);
  const [dataParDirExists, setDataParDirExists] = useState<boolean | null>(null);

  useEffect(() => {
    invoke<number>("get_cpu_cores")
      .then(setSystemCores)
      .catch((err) => {
        console.warn("[ProcessingStatusAlert] Failed to get CPU cores:", err);
        setSystemCores(0);
      });
  }, []);

  useEffect(() => {
    const rootPath = project?.projectMeta.rootPath;
    if (!rootPath) {
      Promise.resolve().then(() => setDataParDirExists(false));
      return;
    }
    Promise.resolve().then(() => setDataParDirExists(null));
    const dataParDir = `${rootPath}/derivatives/ExploreASL`;
    exists(dataParDir)
      .then(setDataParDirExists)
      .catch((err) => {
        console.warn(
          `[ProcessingStatusAlert] Failed to check dataPar directory existence (${dataParDir}):`,
          err,
        );
        setDataParDirExists(false);
      });
  }, [project?.projectMeta.rootPath]);

  const orphanedSubjects = useMemo(() => {
    const subjectSet = new Set(availableSubjects.map((s) => s.subjectSession));
    return subjectStatuses
      .filter((s) => s.module !== "population" && !subjectSet.has(s.subjectSession))
      .map((s) => s.subjectSession)
      .filter((v, i, a) => a.indexOf(v) === i);
  }, [availableSubjects, subjectStatuses]);

  const configSubjects = config?.subjects;
  const configModules = config?.modules;
  const configSelectedProfileId = config?.selectedProfileId;
  const configWorkers = config?.workers;

  const result = useMemo((): PreflightResult => {
    const errors: string[] = [];
    const warnings: string[] = [];

    const populationOnly = configModules?.length === 1 && configModules[0] === "population";

    if (!configSubjects?.length && !populationOnly) {
      errors.push("No subjects selected. Select at least one subject.");
    }

    if (!configModules?.length) {
      errors.push("No processing modules selected. Select Structural, ASL, or Population.");
    }

    if (!executionProfiles.length) {
      errors.push("No valid execution profile configured. Add one in Settings.");
    } else if (!configSelectedProfileId?.trim()) {
      if (!hasValidProfile()) {
        errors.push("No valid execution profile configured. Add one in Settings.");
      } else {
        errors.push("No execution profile selected.");
      }
    } else {
      const profile = getProfileById(configSelectedProfileId);
      if (!profile) {
        errors.push("Selected execution profile not found. Choose another in Settings.");
      } else {
        const validation = profileValidationState[profile.id];
        if (!validation?.valid) {
          const detail = validation?.errors?.join("; ") ?? "Profile validation failed";
          errors.push(`Execution profile "${profile.label}" is invalid: ${detail}`);
        }
      }
    }

    const workers = configWorkers ?? 0;
    if (workers < 1) {
      errors.push("Worker count must be at least 1.");
    }
    if (systemCores > 0 && workers > systemCores) {
      errors.push(`Worker count (${workers}) exceeds available CPU cores (${systemCores}).`);
    }

    if (configModules?.includes("population") && workers !== 1) {
      errors.push(
        "Population module requires exactly 1 worker (single-threaded for atlas/group statistics).",
      );
    }

    if (configSubjects?.length && workers > configSubjects.length) {
      warnings.push(
        `Spawning fewer workers (${configSubjects.length}) than configured (${workers}) because only ${configSubjects.length} subject${configSubjects.length > 1 ? "s are" : " is"} selected.`,
      );
    }

    if (dataParDirExists === false) {
      warnings.push(
        "derivatives/ExploreASL/ directory does not exist yet. It will be created during processing.",
      );
    }

    if (orphanedSubjects.length > 0) {
      warnings.push(
        `Found ${orphanedSubjects.length} orphaned lock file entr${orphanedSubjects.length === 1 ? "y" : "ies"} with no matching rawdata subject: ${orphanedSubjects.slice(0, 5).join(", ")}${orphanedSubjects.length > 5 ? ` (+${orphanedSubjects.length - 5} more)` : ""}`,
      );
    }

    return { errors, warnings, ready: errors.length === 0 };
  }, [
    configSubjects,
    configModules,
    configSelectedProfileId,
    configWorkers,
    executionProfiles,
    profileValidationState,
    hasValidProfile,
    getProfileById,
    systemCores,
    dataParDirExists,
    orphanedSubjects,
  ]);

  const state: AlertState = useMemo(() => {
    const hasSelection = (configModules?.length ?? 0) > 0 || (configSubjects?.length ?? 0) > 0;
    const fsPending = dataParDirExists === null;
    if (fsPending && hasSelection) return "checking";
    if (!hasSelection) return "idle";
    if (result.errors.length > 0) return "error";
    if (result.warnings.length > 0) return "warning";
    return "ready";
  }, [configModules, configSubjects, dataParDirExists, result.errors.length, result.warnings.length]);

  useEffect(() => {
    if (state === "checking") return;
    onResult?.(result);
  }, [state, result, onResult]);

  if (!config) return null;

  const color =
    state === "error"
      ? "red"
      : state === "warning"
        ? "yellow"
        : state === "ready"
          ? "teal"
          : "gray";
  const icon = renderIcon(state);

  return (
    <Alert
      color={color}
      icon={icon}
      variant="light"
      data-testid="processing-status-alert"
      data-state={state}
    >
      {state === "idle" && <Text size="sm">Select the Modules and Subject/Sessions to run</Text>}
      {state === "checking" && <Text size="sm">Checking environment...</Text>}
      {state === "error" && renderMessageList(result.errors)}
      {state === "warning" && renderMessageList(result.warnings)}
      {state === "ready" && <Text size="sm">All checks passed. Ready to process.</Text>}
    </Alert>
  );
}

function renderIcon(state: AlertState) {
  switch (state) {
    case "idle":
      return <IconCircleMinus size={16} />;
    case "checking":
      return <IconLoader size={16} />;
    case "error":
      return <IconAlertTriangle size={16} />;
    case "warning":
      return <IconInfoCircle size={16} />;
    case "ready":
      return <IconCircleCheck size={16} />;
  }
}

function renderMessageList(messages: string[]) {
  if (messages.length === 1) {
    return (
      <Text size="sm" data-testid="processing-status-item">
        {messages[0]}
      </Text>
    );
  }
  return (
    <List size="sm" spacing={4}>
      {messages.map((msg) => (
        <List.Item key={msg} data-testid="processing-status-item">
          {msg}
        </List.Item>
      ))}
    </List>
  );
}

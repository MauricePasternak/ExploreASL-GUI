import { useEffect, useMemo } from "react";
import { Alert, List, Text } from "@mantine/core";
import {
  IconAlertTriangle,
  IconCircleCheck,
  IconInfoCircle,
  IconCircleMinus,
} from "@tabler/icons-react";

import { useGlobalStore } from "../../stores/globalStore";
import { useProcessingStore } from "../../stores/processingStore";
import { useProjectStore } from "../../stores/projectStore";
import { useProcessingEnvironment } from "../../hooks/useProcessingEnvironment";
import {
  hasMissingParameterSwitches,
  SWITCH_CONFIRMATION_GUIDANCE,
} from "../../lib/dataParDefaults";

export interface PreflightResult {
  errors: string[];
  warnings: string[];
  ready: boolean;
}

type AlertState = "idle" | "error" | "warning" | "ready";

interface ProcessingStatusAlertProps {
  onResult?: (result: PreflightResult) => void;
}

export default function ProcessingStatusAlert({ onResult }: ProcessingStatusAlertProps) {
  const config = useProjectStore((s) => s.project?.uiState.processing?.config);
  const dataPar = useProjectStore((s) => s.project?.dataPar);
  const executionProfiles = useGlobalStore((s) => s.settings.executionProfiles);
  const profileValidationState = useGlobalStore((s) => s.profileValidationState);
  const hasValidProfile = useGlobalStore((s) => s.hasValidProfile);
  const getProfileById = useGlobalStore((s) => s.getProfileById);
  const availableSubjects = useProcessingStore((s) => s.availableSubjects);
  const subjectStatuses = useProcessingStore((s) => s.subjectStatuses);

  const { systemCores } = useProcessingEnvironment();

  const orphanedSubjects = useMemo(() => {
    const subjectSet = new Set(availableSubjects.map((s) => s.subjectSession));
    const seen = new Set<string>();
    const out: string[] = [];
    for (const s of subjectStatuses) {
      if (s.module === "population") continue;
      if (subjectSet.has(s.subjectSession)) continue;
      if (seen.has(s.subjectSession)) continue;
      seen.add(s.subjectSession);
      out.push(s.subjectSession);
    }
    return out;
  }, [availableSubjects, subjectStatuses]);

  const configSubjects = config?.subjects;
  const configModules = config?.modules;
  const configSelectedProfileId = config?.selectedProfileId;
  const configWorkers = config?.workers;

  const result = useMemo((): PreflightResult => {
    const errors: string[] = [];
    const warnings: string[] = [];
    if (hasMissingParameterSwitches(dataPar)) errors.push(SWITCH_CONFIRMATION_GUIDANCE);

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

    if (configModules?.includes("asl") && configSubjects?.length) {
      const subjectsLackingASL = configSubjects.filter((subjSession) => {
        const found = availableSubjects.find((s) => s.subjectSession === subjSession);
        return found ? found.hasASL === false : false;
      });

      if (subjectsLackingASL.length > 0) {
        errors.push(
          `Cannot run ASL module because some selected subjects lack ASL data: ${subjectsLackingASL.join(", ")}`,
        );
      }
    }

    if (configSubjects?.length && workers > configSubjects.length) {
      warnings.push(
        `Only ${configSubjects.length} worker${configSubjects.length === 1 ? "" : "s"} will run for ${configSubjects.length} selected session${configSubjects.length === 1 ? "" : "s"}.`,
      );
    }

    if (orphanedSubjects.length > 0) {
      warnings.push(
        `${orphanedSubjects.length} session${orphanedSubjects.length === 1 ? "" : "s"} in earlier processing results ${orphanedSubjects.length === 1 ? "is" : "are"} not in this project: ${orphanedSubjects.slice(0, 5).join(", ")}${orphanedSubjects.length > 5 ? ` (+${orphanedSubjects.length - 5} more)` : ""}`,
      );
    }

    return { errors, warnings, ready: errors.length === 0 };
  }, [
    dataPar,
    configSubjects,
    configModules,
    configSelectedProfileId,
    configWorkers,
    executionProfiles,
    profileValidationState,
    hasValidProfile,
    getProfileById,
    systemCores,
    orphanedSubjects,
    availableSubjects,
  ]);

  const state: AlertState = useMemo(() => {
    const hasSelection = (configModules?.length ?? 0) > 0 || (configSubjects?.length ?? 0) > 0;
    if (!hasSelection) return "idle";
    if (result.errors.length > 0) return "error";
    if (result.warnings.length > 0) return "warning";
    return "ready";
  }, [configModules, configSubjects, result.errors.length, result.warnings.length]);

  useEffect(() => {
    onResult?.(result);
  }, [state, result, onResult]);

  if (!config) return null;

  const color =
    state === "error"
      ? "red"
      : state === "warning"
        ? "yellow"
        : state === "ready"
          ? "blue"
          : "gray";
  const icon = renderIcon(state);

  return (
    <Alert
      color={color}
      icon={icon}
      title={state === "error" ? "Resolve before starting" : undefined}
      variant="light"
      data-testid="processing-status-alert"
      data-state={state}
    >
      {state === "idle" && <Text size="sm">Choose what you want to process.</Text>}
      {state === "error" && renderMessageList(result.errors)}
      {state === "warning" && renderMessageList(result.warnings)}
      {state === "ready" && <Text size="xs">Selection checks passed.</Text>}
    </Alert>
  );
}

function renderIcon(state: AlertState) {
  switch (state) {
    case "idle":
      return <IconCircleMinus size={16} />;
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

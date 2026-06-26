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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PreflightResult {
  errors: string[];
  warnings: string[];
  ready: boolean;
}

type AlertState = "idle" | "checking" | "error" | "warning" | "ready";

interface ProcessingStatusAlertProps {
  onResult?: (result: PreflightResult) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ProcessingStatusAlert({ onResult }: ProcessingStatusAlertProps) {
  const config = useProcessingStore((s) => s.config);
  const settings = useGlobalStore((s) => s.settings);
  const project = useProjectStore((s) => s.project);
  const availableSubjects = useProcessingStore((s) => s.availableSubjects);
  const subjectStatuses = useProcessingStore((s) => s.subjectStatuses);

  const [systemCores, setSystemCores] = useState(0);
  const [matlabExists, setMatlabExists] = useState<boolean | null>(null);
  const [exploreAslExists, setExploreAslExists] = useState<boolean | null>(null);
  const [exploreAslHasM, setExploreAslHasM] = useState<boolean | null>(null);
  const [dataParDirExists, setDataParDirExists] = useState<boolean | null>(null);

  // Query system cores once
  useEffect(() => {
    invoke<number>("get_cpu_cores")
      .then(setSystemCores)
      .catch(() => setSystemCores(0));
  }, []);

  // Check MATLAB executable existence
  useEffect(() => {
    const path = config?.matlabPath;
    if (!path?.trim()) {
      Promise.resolve().then(() => setMatlabExists(false));
      return;
    }
    Promise.resolve().then(() => setMatlabExists(null));
    exists(path)
      .then(setMatlabExists)
      .catch(() => setMatlabExists(false));
  }, [config?.matlabPath]);

  // Check ExploreASL path and ExploreASL.m
  useEffect(() => {
    const path = config?.exploreAslPath ?? settings.exploreAslPath;
    if (!path?.trim()) {
      Promise.resolve().then(() => {
        setExploreAslExists(false);
        setExploreAslHasM(false);
      });
      return;
    }
    Promise.resolve().then(() => {
      setExploreAslExists(null);
      setExploreAslHasM(null);
    });
    Promise.all([exists(path), exists(`${path}/ExploreASL.m`)])
      .then(([dirExists, mExists]) => {
        setExploreAslExists(dirExists);
        setExploreAslHasM(mExists);
      })
      .catch(() => {
        setExploreAslExists(false);
        setExploreAslHasM(false);
      });
  }, [config?.exploreAslPath, settings.exploreAslPath]);

  // Check dataPar.json directory
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
      .catch(() => setDataParDirExists(false));
  }, [project?.projectMeta.rootPath]);

  // Orphaned lock entries: subjects in subjectStatuses but not in availableSubjects.
  // Population is group-level (subjectSession is empty) — exclude from orphan check.
  const orphanedSubjects = useMemo(() => {
    const subjectSet = new Set(availableSubjects.map((s) => s.subjectSession));
    return subjectStatuses
      .filter((s) => s.module !== "population" && !subjectSet.has(s.subjectSession))
      .map((s) => s.subjectSession)
      .filter((v, i, a) => a.indexOf(v) === i);
  }, [availableSubjects, subjectStatuses]);

  const configSubjects = config?.subjects;
  const configModules = config?.modules;
  const configMatlabPath = config?.matlabPath;
  const configExploreAslPath = config?.exploreAslPath;
  const configWorkers = config?.workers;

  // Compute validation result
  const result = useMemo((): PreflightResult => {
    const errors: string[] = [];
    const warnings: string[] = [];

    const populationOnly = configModules?.length === 1 && configModules[0] === "population";

    // Hard block: subjects selected (not required for population-only runs)
    if (!configSubjects?.length && !populationOnly) {
      errors.push("No subjects selected. Select at least one subject.");
    }

    // Hard block: modules selected
    if (!configModules?.length) {
      errors.push("No processing modules selected. Select Structural, ASL, or Population.");
    }

    // Hard block: MATLAB path
    // Global store check takes precedence: if no MATLAB installations are
    // registered in settings, the project config's matlabPath may be stale
    // (e.g. from a different machine or before settings were reset). Reject
    // regardless of whether the path exists on disk.
    if (!settings.matlabInstallations.length) {
      errors.push("No MATLAB installation configured. Add one in Settings.");
    } else if (!configMatlabPath?.trim()) {
      errors.push("No MATLAB installation configured. Add one in Settings.");
    } else if (matlabExists === false) {
      errors.push(`MATLAB executable not found at "${configMatlabPath}". Check Settings.`);
    }

    // Hard block: ExploreASL path
    const explorePath = configExploreAslPath ?? settings.exploreAslPath;
    if (!explorePath?.trim()) {
      errors.push("No ExploreASL path configured. Set it in Settings.");
    } else {
      if (exploreAslExists === false) {
        errors.push(`ExploreASL directory not found at "${explorePath}". Check Settings.`);
      } else if (exploreAslHasM === false) {
        errors.push(
          `ExploreASL.m not found in "${explorePath}". Verify the ExploreASL installation.`,
        );
      }
    }

    // Hard block: worker count
    const workers = configWorkers ?? 0;
    if (workers < 1) {
      errors.push("Worker count must be at least 1.");
    }
    if (systemCores > 0 && workers > systemCores) {
      errors.push(`Worker count (${workers}) exceeds available CPU cores (${systemCores}).`);
    }

    // Hard block: population + workers > 1
    if (configModules?.includes("population") && workers !== 1) {
      errors.push(
        "Population module requires exactly 1 worker (single-threaded for atlas/group statistics).",
      );
    }

    // Soft warning: worker count exceeds selected subjects
    if (configSubjects?.length && workers > configSubjects.length) {
      warnings.push(
        `Spawning fewer workers (${configSubjects.length}) than configured (${workers}) because only ${configSubjects.length} subject${configSubjects.length > 1 ? "s are" : " is"} selected.`,
      );
    }

    // Soft warning: dataPar.json directory
    if (dataParDirExists === false) {
      warnings.push(
        "derivatives/ExploreASL/ directory does not exist yet. It will be created during processing.",
      );
    }

    // Soft warning: orphaned lock entries
    if (orphanedSubjects.length > 0) {
      warnings.push(
        `Found ${orphanedSubjects.length} orphaned lock file entr${orphanedSubjects.length === 1 ? "y" : "ies"} with no matching rawdata subject: ${orphanedSubjects.slice(0, 5).join(", ")}${orphanedSubjects.length > 5 ? ` (+${orphanedSubjects.length - 5} more)` : ""}`,
      );
    }

    return { errors, warnings, ready: errors.length === 0 };
  }, [
    configSubjects,
    configModules,
    configMatlabPath,
    configExploreAslPath,
    configWorkers,
    settings.exploreAslPath,
    settings.matlabInstallations,
    systemCores,
    matlabExists,
    exploreAslExists,
    exploreAslHasM,
    dataParDirExists,
    orphanedSubjects,
  ]);

  // Determine state: idle < checking < error < warning < ready
  const state: AlertState = useMemo(() => {
    const hasSelection = (configModules?.length ?? 0) > 0 || (configSubjects?.length ?? 0) > 0;
    const fsPending =
      matlabExists === null ||
      exploreAslExists === null ||
      exploreAslHasM === null ||
      dataParDirExists === null;
    if (fsPending && hasSelection) return "checking";
    if (!hasSelection) return "idle";
    if (result.errors.length > 0) return "error";
    if (result.warnings.length > 0) return "warning";
    return "ready";
  }, [
    configModules,
    configSubjects,
    matlabExists,
    exploreAslExists,
    exploreAslHasM,
    dataParDirExists,
    result.errors.length,
    result.warnings.length,
  ]);

  // Report result to parent whenever state is stable (not checking)
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

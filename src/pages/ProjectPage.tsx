import { Center, Loader, Stack, Text } from "@mantine/core";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";

import DataParEditor from "../components/parameters/DataParEditor";
import { resolveRestoredPhase, tryRestoreProjectSession } from "../lib/restoreProjectSession";
import { syncSessionCheckpointFromProject } from "../lib/sessionCheckpoint";
import { canAccessPhase, PROJECT_PHASES, type ProjectPhase } from "../schemas/project";
import { useDataParStore } from "../stores/dataParStore";
import { useImportStore } from "../stores/importStore";
import { useProjectStore } from "../stores/projectStore";
import ImportPage from "./ImportPage";
import ManifestPage from "./ManifestPage";
import ProcessingPage from "./ProcessingPage";
import VisualizationPage from "./VisualizationPage";

function isProjectPhase(value: string | undefined): value is ProjectPhase {
  return PROJECT_PHASES.includes(value as ProjectPhase);
}

export default function ProjectPage() {
  const navigate = useNavigate();
  const params = useParams();
  const project = useProjectStore((state) => state.project);
  const setPhase = useProjectStore((state) => state.setPhase);
  const saveProject = useProjectStore((state) => state.saveProject);
  const loadPersistedState = useImportStore((state) => state.loadPersistedState);
  const [restoring, setRestoring] = useState(() => !useProjectStore.getState().project);
  const restoreInFlight = useRef(false);
  const hadProjectRef = useRef(Boolean(useProjectStore.getState().project));
  const hydratedProjectId = useRef<string | null>(null);
  const hydratedDataParProjectId = useRef<string | null>(null);

  // Hydrate dataPar store once per opened project
  useEffect(() => {
    if (!project) {
      hydratedDataParProjectId.current = null;
      useDataParStore.getState().resetDataPar();
      return;
    }

    if (hydratedDataParProjectId.current === project.projectMeta.id) {
      return;
    }

    hydratedDataParProjectId.current = project.projectMeta.id;

    if (project.dataPar) {
      useDataParStore.getState().loadDataPar(project.dataPar);
    }
    if (project.uiState?.datapar?.advancedVisibility) {
      useDataParStore.getState().setAdvancedVisibility(project.uiState.datapar.advancedVisibility);
    }
  }, [project]);

  // Hydrate import store once per opened project (not on every mappingState autosave)
  useEffect(() => {
    if (!project) {
      hydratedProjectId.current = null;
      return;
    }

    if (hydratedProjectId.current === project.projectMeta.id) {
      return;
    }

    hydratedProjectId.current = project.projectMeta.id;
    const mappingState = project.mappingState;
    const hasPersistedImportState =
      Object.keys(mappingState).length > 0 ||
      project.uiState?.import?.activeStep !== undefined ||
      project.uiState?.import?.currentPhase !== undefined ||
      project.uiState?.import?.completed !== undefined ||
      project.uiState?.import?.selectedProfileId !== undefined;

    if (!hasPersistedImportState) {
      return;
    }

    const persistedState = {
      ...mappingState,
      activeStep: project.uiState?.import?.activeStep,
      importPhase: project.uiState?.import?.currentPhase,
      importCompleted: project.uiState?.import?.completed,
      mostRecentConfig: project.uiState?.import?.mostRecentConfig,
      selectedProfileId: project.uiState?.import?.selectedProfileId,
    };
    loadPersistedState(persistedState as Record<string, unknown>);
  }, [project?.projectMeta.id, loadPersistedState, project]);

  // After reload, rehydrate project from session checkpoint or recent projects
  useEffect(() => {
    if (project) {
      hadProjectRef.current = true;
      restoreInFlight.current = false;
      Promise.resolve().then(() => setRestoring(false));
      return;
    }

    if (!params.id) {
      return;
    }

    if (hadProjectRef.current) {
      hadProjectRef.current = false;
      Promise.resolve().then(() => setRestoring(false));
      navigate("/", { replace: true });
      return;
    }

    if (restoreInFlight.current) {
      return;
    }

    restoreInFlight.current = true;
    let cancelled = false;

    async function restore() {
      setRestoring(true);
      const restored = await tryRestoreProjectSession(params.id!);
      if (cancelled) {
        return;
      }
      restoreInFlight.current = false;
      setRestoring(false);

      if (!restored) {
        // Project failed to load / doesn't exist
        navigate("/", { replace: true });
      }
    }

    void restore();

    return () => {
      cancelled = true;
    };
  }, [params.id, navigate, project]);

  // Keep project session checkpoint up to date as we navigate/change settings
  useEffect(() => {
    if (!project) {
      return;
    }
    void syncSessionCheckpointFromProject(project);
  }, [project]);

  // Route guarding based on phase accessibility
  useEffect(() => {
    if (!project) {
      return;
    }

    // Default to the project's currentPhase if no phase parameter is present
    if (!params.phase) {
      const resolvedPhase = resolveRestoredPhase(undefined, project);
      navigate(`/project/${project.projectMeta.id}/${resolvedPhase}`, {
        replace: true,
      });
      return;
    }

    if (!isProjectPhase(params.phase)) {
      navigate(`/project/${project.projectMeta.id}/${project.projectMeta.currentPhase}`, {
        replace: true,
      });
      return;
    }

    if (!canAccessPhase(project, params.phase)) {
      navigate(`/project/${project.projectMeta.id}/${project.projectMeta.currentPhase}`, {
        replace: true,
      });
      return;
    }

    if (project.projectMeta.currentPhase !== params.phase) {
      setPhase(params.phase);
      void saveProject();
    }
  }, [navigate, params.phase, project, saveProject, setPhase]);

  // Register active project root for niivue:// protocol
  const rootPath = project?.projectMeta.rootPath;
  useEffect(() => {
    if (!rootPath) return;
    invoke("set_active_project", { rootPath }).catch(console.error);
    return () => {
      invoke("clear_active_project").catch(console.error);
    };
  }, [rootPath]);

  if (!project) {
    if (restoring) {
      return (
        <Center h={240} data-testid="project-restoring">
          <Stack align="center" gap="sm">
            <Loader size="sm" />
            <Text c="dimmed">Restoring project…</Text>
          </Stack>
        </Center>
      );
    }

    return null;
  }

  // Route to the appropriate phase component
  switch (params.phase) {
    case "import":
      return <ImportPage />;
    case "parameters":
      return <DataParEditor />;
    case "processing":
      return <ProcessingPage />;
    case "visualization":
      return <VisualizationPage />;
    case "manifest":
      return <ManifestPage />;
    default:
      return <Text>Current phase: {project.projectMeta.currentPhase}</Text>;
  }
}

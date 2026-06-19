import { useEffect, useRef, useState } from "react";
import { Center, Loader, Stack, Text } from "@mantine/core";
import { useNavigate, useParams } from "react-router";

import { resolveRestoredPhase, tryRestoreProjectSession } from "../lib/restoreProjectSession";
import { syncSessionCheckpointFromProject } from "../lib/sessionCheckpoint";
import { canAccessPhase, PROJECT_PHASES, type ProjectPhase } from "../schemas/project";
import { useProjectStore } from "../stores/projectStore";
import { useImportStore } from "../stores/importStore";
import ImportPage from "./ImportPage";
import ProcessingPage from "./ProcessingPage";
import DataParEditor from "../components/parameters/DataParEditor";

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
      project.uiState?.import?.completed !== undefined;

    if (!hasPersistedImportState) {
      return;
    }

    const persistedState = {
      ...mappingState,
      activeStep: project.uiState?.import?.activeStep,
      importPhase: project.uiState?.import?.currentPhase,
      importCompleted: project.uiState?.import?.completed,
    };
    loadPersistedState(persistedState as Record<string, unknown>);
  }, [project?.projectMeta.id, loadPersistedState, project]);

  // After reload, rehydrate project from session checkpoint or recent projects
  useEffect(() => {
    if (project) {
      hadProjectRef.current = true;
      restoreInFlight.current = false;
      setRestoring(false);
      return;
    }

    if (!params.id) {
      navigate("/", { replace: true });
      return;
    }

    if (hadProjectRef.current) {
      hadProjectRef.current = false;
      setRestoring(false);
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

      if (!restored) {
        restoreInFlight.current = false;
        setRestoring(false);
        navigate("/", { replace: true });
        return;
      }

      const loaded = useProjectStore.getState().project;
      if (!loaded) {
        restoreInFlight.current = false;
        setRestoring(false);
        navigate("/", { replace: true });
        return;
      }

      const phase = resolveRestoredPhase(params.phase, loaded);
      navigate(`/project/${loaded.projectMeta.id}/${phase}`, { replace: true });
      restoreInFlight.current = false;
      setRestoring(false);
    }

    void restore();

    return () => {
      cancelled = true;
    };
  }, [navigate, params.id, params.phase, project]);

  // Keep checkpoint aligned with the active route while a project is open
  useEffect(() => {
    if (!project) {
      return;
    }

    const phase = isProjectPhase(params.phase) ? params.phase : project.projectMeta.currentPhase;
    syncSessionCheckpointFromProject(project, phase);
  }, [params.phase, project]);

  useEffect(() => {
    if (!project) {
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
    default:
      return <Text>Current phase: {project.projectMeta.currentPhase}</Text>;
  }
}

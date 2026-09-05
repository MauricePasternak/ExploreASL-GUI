import { Center, Loader, Stack, Text } from "@mantine/core";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";

import DataParEditor from "../components/parameters/DataParEditor";
import { resolveRestoredPhase, tryRestoreProjectSession } from "../lib/restoreProjectSession";
import { syncSessionCheckpointFromProject } from "../lib/sessionCheckpoint";
import { canAccessPhase, PROJECT_PHASES, type ProjectPhase } from "../schemas/project";
import { useProjectStore } from "../stores/projectStore";
import { useProcessingStore } from "../stores/processingStore";
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
  const processingPhase = useProcessingStore((state) => state.processingPhase);
  const isProcessingActive = ["preparing", "running", "finalizing", "cancelling"].includes(
    processingPhase,
  );
  const [restoring, setRestoring] = useState(() => !useProjectStore.getState().project);
  const restoreInFlight = useRef(false);
  const hadProjectRef = useRef(Boolean(useProjectStore.getState().project));

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

      if (!restored || useProjectStore.getState().recovery) {
        // Project failed to load, does not exist, or needs recovery confirmation.
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

    const isVisualizationOrManifest =
      params.phase === "visualization" || params.phase === "manifest";
    if (
      !canAccessPhase(project, params.phase) ||
      (isProcessingActive && isVisualizationOrManifest)
    ) {
      const fallbackPhase =
        project.projectMeta.currentPhase === "visualization" ||
        project.projectMeta.currentPhase === "manifest"
          ? "processing"
          : project.projectMeta.currentPhase;
      navigate(`/project/${project.projectMeta.id}/${fallbackPhase}`, {
        replace: true,
      });
      return;
    }

    if (project.projectMeta.currentPhase !== params.phase) {
      setPhase(params.phase);
      void saveProject();
    }
  }, [navigate, params.phase, project, saveProject, setPhase, isProcessingActive]);

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

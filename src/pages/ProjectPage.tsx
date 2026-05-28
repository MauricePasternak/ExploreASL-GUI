import { useEffect } from "react";
import { Text } from "@mantine/core";
import { useNavigate, useParams } from "react-router";

import { canAccessPhase, PROJECT_PHASES, type ProjectPhase } from "../schemas/project";
import { useProjectStore } from "../stores/projectStore";
import ImportPage from "./ImportPage";

function isProjectPhase(value: string | undefined): value is ProjectPhase {
  return PROJECT_PHASES.includes(value as ProjectPhase);
}

export default function ProjectPage() {
  const navigate = useNavigate();
  const params = useParams();
  const project = useProjectStore((state) => state.project);
  const setPhase = useProjectStore((state) => state.setPhase);
  const saveProject = useProjectStore((state) => state.saveProject);

  useEffect(() => {
    if (!project) {
      return;
    }

    if (!isProjectPhase(params.phase)) {
      navigate(`/project/${project.projectMeta.id}/${project.projectMeta.currentPhase}`, { replace: true });
      return;
    }

    if (!canAccessPhase(project.projectMeta.currentPhase, params.phase)) {
      navigate(`/project/${project.projectMeta.id}/${project.projectMeta.currentPhase}`, { replace: true });
      return;
    }

    if (project.projectMeta.currentPhase !== params.phase) {
      setPhase(params.phase);
      void saveProject();
    }
  }, [navigate, params.phase, project, saveProject, setPhase]);

  if (!project) {
    return <Text>No project is currently loaded.</Text>;
  }

  // Route to the appropriate phase component
  switch (params.phase) {
    case "import":
      return <ImportPage />;
    case "parameters":
      return <Text>Parameters configuration (Phase 3 — coming soon)</Text>;
    case "processing":
      return <Text>Processing dashboard (Phase 4 — coming soon)</Text>;
    default:
      return <Text>Current phase: {project.projectMeta.currentPhase}</Text>;
  }
}

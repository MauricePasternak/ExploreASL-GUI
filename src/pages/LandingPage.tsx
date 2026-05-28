import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { notifications } from "@mantine/notifications";
import { Button, Container, Divider, Group, Paper, Stack, Text, Title } from "@mantine/core";
import { IconFolderOpen, IconPlus } from "@tabler/icons-react";
import { open } from "@tauri-apps/plugin-dialog";
import { exists } from "@tauri-apps/plugin-fs";
import { useNavigate } from "react-router";

import { PROJECT_FILE_NAME } from "../schemas/project";
import { useGlobalStore } from "../stores/globalStore";
import { useProjectStore } from "../stores/projectStore";
import RecentProjectsList from "../components/RecentProjectsList";
import { logAction } from "../lib/debug";

export default function LandingPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const createProject = useProjectStore((state) => state.createProject);
  const loadProject = useProjectStore((state) => state.loadProject);
  const addRecentProject = useGlobalStore((state) => state.addRecentProject);

  function showError(title: string, message: string) {
    notifications.show({
      color: "red",
      title,
      message,
    });
  }

  async function handleNewProject() {
    setLoading(true);
    logAction("landing_new_project_start");

    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Select Project Root Directory",
      });

      if (typeof selected !== "string") {
        logAction("landing_new_project_cancelled");
        return;
      }

      const projectName = selected.split("/").filter(Boolean).pop() ?? "Untitled";
      const projectPath = `${selected}/${PROJECT_FILE_NAME}`;
      const writable = (await invoke("is_writable", { path: selected })) as boolean;
      if (!writable) {
        showError("Directory not writable", `Cannot create project in ${selected}. Check permissions.`);
        logAction("landing_new_project_error", { reason: "not_writable", path: selected });
        return;
      }

      if (await exists(projectPath)) {
        showError("Project exists", `An ExploreASL GUI project already exists in ${selected}.`);
        logAction("landing_new_project_error", { reason: "exists", path: selected });
        return;
      }

      await createProject(selected, projectName);
      addRecentProject(projectPath);
      logAction("landing_new_project_created", { path: selected, name: projectName });

      const project = useProjectStore.getState().project;
      if (project) {
        navigate(`/project/${project.projectMeta.id}/import`);
      }
    } catch {
      showError(
        "Failed to create project",
        "ExploreASL GUI could not initialize the project files in the selected directory.",
      );
      logAction("landing_new_project_error", { reason: "exception" });
    } finally {
      setLoading(false);
    }
  }

  async function handleOpenProject() {
    setLoading(true);
    logAction("landing_open_project_start");

    try {
      const selected = await open({
        filters: [{ name: "ExploreASL Project", extensions: ["easl"] }],
        multiple: false,
        title: "Open Project File",
      });

      if (typeof selected !== "string") {
        logAction("landing_open_project_cancelled");
        return;
      }

      try {
        await loadProject(selected);
      } catch {
        showError(
          "Invalid project file",
          "Failed to open project. The file may be corrupted or from a newer version.",
        );
        logAction("landing_open_project_error", { path: selected, reason: "invalid_file" });
        return;
      }
      addRecentProject(selected);
      logAction("landing_open_project_success", { path: selected });

      const project = useProjectStore.getState().project;
      if (project) {
        navigate(`/project/${project.projectMeta.id}/${project.projectMeta.currentPhase}`);
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleOpenRecent(path: string) {
    setLoading(true);
    logAction("landing_open_recent_start", { path });

    try {
      await loadProject(path);
      addRecentProject(path);
      logAction("landing_open_recent_success", { path });

      const project = useProjectStore.getState().project;
      if (project) {
        navigate(`/project/${project.projectMeta.id}/${project.projectMeta.currentPhase}`);
      }
    } catch {
      showError(
        "Invalid project file",
        "Failed to open project. The file may be corrupted or from a newer version.",
      );
      logAction("landing_open_recent_error", { path });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Container size="md" py="xl">
      <Stack gap="xl">
        <div>
          <Title order={1}>ExploreASL GUI</Title>
          <Text c="dimmed" mt="xs">
            A graphical interface for the ExploreASL arterial spin labeling MRI pipeline.
          </Text>
        </div>

        <Paper withBorder radius="md" p="lg">
          <Group>
            <Button
              size="lg"
              leftSection={<IconPlus size={20} />}
              loading={loading}
              onClick={handleNewProject}
              data-testid="landing-new-project-btn"
            >
              New Project
            </Button>
            <Button
              size="lg"
              variant="outline"
              leftSection={<IconFolderOpen size={20} />}
              loading={loading}
              onClick={handleOpenProject}
              data-testid="landing-open-project-btn"
            >
              Open Project
            </Button>
          </Group>
        </Paper>

        <Divider label="Recent Projects" labelPosition="center" />

        <RecentProjectsList onOpen={handleOpenRecent} />
      </Stack>
    </Container>
  );
}

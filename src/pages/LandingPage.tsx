import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { notifications } from "@mantine/notifications";
import { Button, Divider, Group, Image, Stack, Text } from "@mantine/core";
import { IconFolderOpen, IconPlus } from "@tabler/icons-react";
import { open } from "@tauri-apps/plugin-dialog";
import { exists } from "@tauri-apps/plugin-fs";
import { useNavigate } from "react-router";

import { PROJECT_FILE_NAME } from "../schemas/project";
import { useGlobalStore } from "../stores/globalStore";
import { useProjectStore } from "../stores/projectStore";
import RecentProjectsList from "../components/RecentProjectsList";
import { logAction } from "../lib/debug";
import appLogo from "../../src-tauri/icons/easl_gui_logo.png";

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
        showError(
          "Directory not writable",
          `Cannot create project in ${selected}. Check permissions.`,
        );
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
    <div
      data-testid="landing-page"
      style={{
        display: "flex",
        flexDirection: "column",
        /* Break out of AppShell.Main padding on all four sides */
        margin: "calc(-1 * var(--app-shell-padding))",
      }}
    >
      {/* Keyframe animation injected once */}
      <style>{`
        @keyframes bloodFlow {
          0%   { background-position: 50% 0% }
          50%  { background-position: 50% 100% }
          100% { background-position: 50% 0% }
        }
        .hero-gradient {
          background: linear-gradient(
            180deg,
            #f0d6db 0%,
            #e2d0e8 25%,
            #c8d9ee 50%,
            #d0e6f5 75%,
            #c5ddf7 100%
          );
          background-size: 100% 300%;
          animation: bloodFlow 10s ease-in-out infinite;
        }
      `}</style>

      {/* Full-bleed hero — breaks out of any parent padding via negative margin trick */}
      <div
        className="hero-gradient"
        data-testid="landing-hero"
        style={{ padding: "48px 32px 56px" }}
      >
        {/* Inner content stays centred with a max-width cap */}
        <div
          data-testid="landing-hero-content"
          style={{
            maxWidth: 720,
            margin: "0 auto",
            display: "flex",
            alignItems: "center",
            gap: 32,
          }}
        >
          <Image
            src={appLogo}
            alt="ExploreASL Logo"
            w={120}
            h={120}
            style={{ flexShrink: 0, filter: "drop-shadow(0 2px 8px rgba(0,0,0,0.15))" }}
            data-testid="landing-logo"
          />
          <div data-testid="landing-hero-text-container">
            <Text
              component="h1"
              data-testid="landing-hero-title"
              style={{
                fontSize: "2.6rem",
                fontWeight: 900,
                color: "#1a2a4a",
                lineHeight: 1.1,
                margin: 0,
              }}
            >
              Welcome to ExploreASL
            </Text>
            <Text
              mt="sm"
              data-testid="landing-hero-subtitle"
              style={{
                color: "#3a4f6e",
                fontSize: "1rem",
                maxWidth: 400,
              }}
            >
              A graphical interface for the ExploreASL arterial spin labeling MRI pipeline.
            </Text>
          </div>
        </div>
      </div>

      {/* Page body */}
      <div
        data-testid="landing-body-container"
        style={{
          flex: 1,
          padding: "var(--mantine-spacing-xl) var(--app-shell-padding)",
          maxWidth: 960,
          marginLeft: "auto",
          marginRight: "auto",
          width: "100%",
        }}
      >
        <Stack gap="xl" data-testid="landing-body-stack">
          {/* Action Buttons — centred */}
          <Group justify="center" data-testid="landing-actions-group">
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

          <Divider
            label="Recent Projects"
            labelPosition="center"
            data-testid="landing-recent-projects-divider"
          />

          <RecentProjectsList
            onOpen={handleOpenRecent}
            data-testid="landing-recent-projects-list"
          />
        </Stack>
      </div>
    </div>
  );
}

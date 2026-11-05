import {
  ActionIcon,
  Alert,
  AppShell,
  Badge,
  Button,
  Burger,
  Group,
  Image,
  Modal,
  NavLink,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import appLogo from "../../src-tauri/icons/easl_gui_logo.png";
import { notifications } from "@mantine/notifications";
import { useDisclosure } from "@mantine/hooks";
import {
  IconAdjustments,
  IconChartScatter,
  IconChevronLeft,
  IconChevronRight,
  IconFileReport,
  IconHelp,
  IconHome,
  IconPlayerPlay,
  IconRefresh,
  IconRefreshAlert,
  IconSettings,
  IconUpload,
} from "@tabler/icons-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { canAccessPhase, type ProjectPhase } from "../schemas/project";
import { useProcessingStore } from "../stores/processingStore";
import { useImportStore } from "../stores/importStore";
import { useProjectStore } from "../stores/projectStore";
import { useVisualizationStore } from "../stores/visualizationStore";
import { logAction } from "../lib/debug";
import { showErrorNotification } from "../lib/errorNotifications";
import { ProjectStorageError, projectStorageErrorMessage } from "../lib/projectPersistence";
import ProcessingStatusBar from "./processing/ProcessingStatusBar";
import ProjectName from "./ProjectName";

const PHASE_NAV = [
  { phase: "import", label: "Import", icon: IconUpload },
  { phase: "parameters", label: "Parameters", icon: IconAdjustments },
  { phase: "processing", label: "Processing", icon: IconPlayerPlay },
  { phase: "visualization", label: "Visualization", icon: IconChartScatter },
  { phase: "manifest", label: "Manifest", icon: IconFileReport },
] as const;

export interface LayoutOutletContext {
  onOpenSettings: () => void;
}

interface LayoutProps {
  onOpenSettings: () => void;
}

function showCloseError(projectId: string, title: string, error: unknown) {
  showErrorNotification({
    id: `project-close:${projectId}`,
    title,
    message: "The project could not be safely saved or closed.",
    details:
      error instanceof ProjectStorageError
        ? projectStorageErrorMessage(error)
        : "Keep the project open. Finish active work, correct any invalid fields, and try Save before leaving again.",
    error,
  });
}

export default function Layout({ onOpenSettings }: LayoutProps) {
  const [opened, { toggle, close: closeMobileNav }] = useDisclosure(false);
  const [leaveModalOpen, setLeaveModalOpen] = useState(false);
  const [leaveTarget, setLeaveTarget] = useState<"home" | "exit">("home");
  const project = useProjectStore((state) => state.project);
  const isDirty = useProjectStore((state) => state.isDirty);
  const saving = useProjectStore((state) => state.saving);
  const saveError = useProjectStore((state) => state.saveError);
  const setPhase = useProjectStore((state) => state.setPhase);
  const toggleNavbar = useProjectStore((state) => state.toggleNavbar);
  const saveProject = useProjectStore((state) => state.saveProject);
  const closeProject = useProjectStore((state) => state.closeProject);
  const navigate = useNavigate();
  const location = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const projectNameInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const main = mainRef.current;
    const page = pageRef.current;
    if (!main || !page) return;
    // WebKit can retain an out-of-range offset after content shrinks or the viewport grows.
    const resizeObserver = new ResizeObserver(() => {
      const maxScrollTop = Math.max(0, main.scrollHeight - main.clientHeight);
      if (main.scrollTop > maxScrollTop) main.scrollTop = maxScrollTop;
    });
    const observeContent = () => {
      resizeObserver.disconnect();
      resizeObserver.observe(main);
      resizeObserver.observe(page);
      // The full-height wrapper can overflow without resizing; watch its route roots too.
      for (const child of page.children) resizeObserver.observe(child);
    };
    observeContent();
    const contentObserver = new MutationObserver(observeContent);
    contentObserver.observe(page, { childList: true });
    return () => {
      contentObserver.disconnect();
      resizeObserver.disconnect();
    };
  }, [location.pathname]);

  const saveNow = useCallback(async () => {
    if (!project) return;
    projectNameInput.current?.blur();
    try {
      await saveProject();
      notifications.show({
        color: "teal",
        title: "Project Saved",
        message: "All changes successfully saved to file.",
      });
    } catch {
      // Shared client retains and reports the save failure.
    }
  }, [project, saveProject]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        if (project) {
          event.preventDefault();
          void saveNow();
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [project, saveNow]);

  const processingPhase = useProcessingStore((state) => state.processingPhase);
  const importPhase = useImportStore((state) => state.importPhase);
  const importRunning = useImportStore((state) => state.importRunning);
  const dicomSourceAvailability = useImportStore((state) => state.sourceAvailability);
  const externalSourceAvailability = useVisualizationStore(
    (state) => state.externalSourceAvailability,
  );
  const isProcessRunning =
    ["preparing", "running", "finalizing", "cancelling"].includes(processingPhase) ||
    ["preparing", "running", "finalizing", "cancelling"].includes(importPhase) ||
    importRunning;
  const isImportActive =
    ["preparing", "running", "finalizing", "cancelling"].includes(importPhase) || importRunning;
  const isProcessingActive = ["preparing", "running", "finalizing", "cancelling"].includes(
    processingPhase,
  );

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    let closing = false;

    async function setupCloseListener() {
      try {
        const appWindow = getCurrentWindow();
        const stop = await appWindow.listen<number>("app-close-requested", async ({ payload }) => {
          if (disposed || closing) return;
          const handled = () =>
            appWindow.emitTo("main", "app-close-handled", payload).catch((error) => {
              console.error("Could not acknowledge close request:", error);
            });
          const { project: currentProject } = useProjectStore.getState();
          const currentProcessingPhase = useProcessingStore.getState().processingPhase;
          const currentImportPhase = useImportStore.getState().importPhase;
          const currentImportRunning = useImportStore.getState().importRunning;
          const activeProcess =
            ["preparing", "running", "finalizing", "cancelling"].includes(currentProcessingPhase) ||
            ["preparing", "running", "finalizing", "cancelling"].includes(currentImportPhase) ||
            currentImportRunning;

          if (activeProcess) {
            setLeaveTarget("exit");
            setLeaveModalOpen(true);
            await handled();
            return;
          }
          closing = true;
          try {
            projectNameInput.current?.blur();
            if (currentProject) await useProjectStore.getState().closeProject();
            await appWindow.destroy();
          } catch (error) {
            showCloseError(
              currentProject?.projectMeta.id ?? "none",
              "Could not close project",
              error,
            );
            await handled();
          } finally {
            closing = false;
          }
        });
        if (disposed) stop();
        else unlisten = stop;
      } catch (err) {
        console.error("Failed to setup close listener:", err);
      }
    }

    void setupCloseListener();

    return () => {
      disposed = true;
      if (unlisten) {
        unlisten();
      }
    };
  }, []);

  const processingSubjectCount = useProcessingStore((s) => {
    const subjects = new Set(s.availableSubjects.map((info) => info.subject));
    return subjects.size;
  });
  const subjectCount =
    project?.projectMeta.dataSource === "bids"
      ? new Set(project.mappingState.subjectRows?.map((row) => row.subject)).size
      : processingSubjectCount;
  const navbarCollapsed = project?.uiState.navbarCollapsed ?? true;

  async function handlePhaseNavigation(phase: ProjectPhase) {
    if (
      !project ||
      !canAccessPhase(project, phase) ||
      (isImportActive && phase !== "import") ||
      (isProcessingActive && (phase === "visualization" || phase === "manifest"))
    ) {
      return;
    }

    logAction("layout_navigate_phase", { phase });
    projectNameInput.current?.blur();
    await useProjectStore.getState().flushEdits();
    const current = useProjectStore.getState().project;
    if (
      current?.activationGeneration !== project.activationGeneration ||
      current.projectMeta.id !== project.projectMeta.id
    )
      return;
    await setPhase(phase);
    await saveProject();
    navigate(`/project/${project.projectMeta.id}/${phase}`);
  }

  async function leaveProject() {
    logAction("layout_leave_project");
    try {
      projectNameInput.current?.blur();
      await closeProject();
      setLeaveModalOpen(false);
      if (leaveTarget === "exit") {
        const appWindow = getCurrentWindow();
        await appWindow.destroy();
      } else {
        closeMobileNav();
        navigate("/");
      }
    } catch (error) {
      showCloseError(project?.projectMeta.id ?? "none", "Could not leave project", error);
    }
  }

  async function handleReturnHome() {
    const { project: currentProject } = useProjectStore.getState();
    const currentProcessingPhase = useProcessingStore.getState().processingPhase;
    const currentImportPhase = useImportStore.getState().importPhase;
    const currentImportRunning = useImportStore.getState().importRunning;
    const activeProcess =
      ["preparing", "running", "finalizing", "cancelling"].includes(currentProcessingPhase) ||
      ["preparing", "running", "finalizing", "cancelling"].includes(currentImportPhase) ||
      currentImportRunning;

    if (!currentProject) {
      navigate("/");
      return;
    }

    if (activeProcess) {
      setLeaveTarget("home");
      setLeaveModalOpen(true);
      return;
    }

    logAction("layout_return_home");
    try {
      projectNameInput.current?.blur();
      await closeProject();
      closeMobileNav();
      navigate("/");
    } catch (error) {
      showCloseError(currentProject.projectMeta.id, "Could not leave project", error);
    }
  }

  return (
    <AppShell
      header={{ height: 56 }}
      footer={project ? { height: 40 } : undefined}
      navbar={{
        width: navbarCollapsed ? 60 : 240,
        breakpoint: "xs",
        collapsed: { desktop: !project, mobile: !opened },
      }}
      padding="md"
    >
      <AppShell.Header data-testid="layout-header">
        <Group
          h="100%"
          px="md"
          justify="space-between"
          wrap="nowrap"
          data-testid="layout-header-content"
        >
          <Group gap="sm" wrap="nowrap" miw={0} data-testid="layout-header-identity">
            {project ? (
              <Burger
                opened={opened}
                onClick={toggle}
                size="sm"
                hiddenFrom="xs"
                data-testid="layout-mobile-nav-toggle"
              />
            ) : null}
            <Image
              src={appLogo}
              alt="ExploreASL GUI"
              h={32}
              w={32}
              style={{ flexShrink: 0 }}
              data-testid="layout-logo"
            />
            {project ? (
              <ProjectName
                key={`${project.projectMeta.id}:${project.activationGeneration}`}
                name={project.projectMeta.name}
                projectId={project.projectMeta.id}
                generation={project.activationGeneration}
                inputRef={projectNameInput}
              />
            ) : null}
          </Group>

          <Group gap="sm" wrap="nowrap" data-testid="layout-header-actions">
            {project ? (
              <Badge variant="light" color="blue" data-testid="layout-phase-badge">
                {project.projectMeta.currentPhase}
              </Badge>
            ) : null}
            {project ? (
              <Tooltip
                label={
                  isDirty
                    ? "Project changes have occurred since last saved state"
                    : "All changes in sync with last saved state"
                }
                position="bottom"
                withArrow
              >
                <ActionIcon
                  aria-label={
                    saving
                      ? "Saving project"
                      : saveError
                        ? "Project save failed; retry"
                        : isDirty
                          ? "Save project changes"
                          : "Project changes in sync"
                  }
                  variant="subtle"
                  color={isDirty ? "yellow" : "gray"}
                  onClick={() => void saveNow()}
                  data-testid="layout-save-status-btn"
                  disabled={saving}
                >
                  {isDirty ? <IconRefreshAlert size={18} /> : <IconRefresh size={18} />}
                </ActionIcon>
              </Tooltip>
            ) : null}
            <Tooltip label="Help & Overview" position="bottom" withArrow>
              <ActionIcon
                aria-label="Open overview"
                variant="subtle"
                color="teal"
                onClick={() => navigate("/overview", { state: { from: location.pathname } })}
                data-testid="layout-open-overview-btn"
              >
                <IconHelp size={18} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Global Settings" withArrow>
              <ActionIcon
                aria-label="Open settings"
                variant="subtle"
                color="blue"
                onClick={onOpenSettings}
                data-testid="layout-open-settings-btn"
              >
                <IconSettings size={18} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>
      </AppShell.Header>

      {project ? (
        <AppShell.Navbar p="xs" data-testid="layout-navbar">
          <Stack gap="xs" h="100%" align={navbarCollapsed ? "center" : "stretch"}>
            <Tooltip
              label={navbarCollapsed ? "Expand navigation" : "Collapse navigation"}
              position="right"
              withArrow
            >
              <ActionIcon
                variant="subtle"
                color="gray"
                onClick={toggleNavbar}
                aria-label={navbarCollapsed ? "Expand navigation" : "Collapse navigation"}
                data-testid="layout-navbar-toggle"
                size="lg"
              >
                {navbarCollapsed ? <IconChevronRight size={18} /> : <IconChevronLeft size={18} />}
              </ActionIcon>
            </Tooltip>

            <div style={{ width: "100%" }} data-testid="layout-navbar-phases">
              {PHASE_NAV.map(({ phase, label, icon: Icon }) => {
                const active = project.projectMeta.currentPhase === phase;
                const disabled =
                  !canAccessPhase(project, phase) ||
                  (isImportActive && phase !== "import") ||
                  (isProcessingActive && (phase === "visualization" || phase === "manifest"));

                const iconElement = (
                  <NavLink
                    key={phase}
                    active={active}
                    component="button"
                    disabled={disabled}
                    label={navbarCollapsed ? undefined : label}
                    leftSection={<Icon size={18} />}
                    onClick={() => void handlePhaseNavigation(phase).catch(() => undefined)}
                    data-testid={`layout-nav-${phase}`}
                  />
                );
                return navbarCollapsed ? (
                  <Tooltip key={phase} label={label} position="right" withArrow>
                    {iconElement}
                  </Tooltip>
                ) : (
                  iconElement
                );
              })}
            </div>

            <div style={{ marginTop: "auto", width: "100%" }} data-testid="layout-navbar-home">
              {navbarCollapsed ? (
                <Tooltip label="Return to home" position="right" withArrow>
                  <NavLink
                    component="button"
                    leftSection={<IconHome size={18} />}
                    onClick={handleReturnHome}
                    data-testid="layout-nav-home"
                  />
                </Tooltip>
              ) : (
                <NavLink
                  component="button"
                  label="Return to home"
                  leftSection={<IconHome size={18} />}
                  onClick={handleReturnHome}
                  data-testid="layout-nav-home"
                />
              )}
            </div>
          </Stack>
        </AppShell.Navbar>
      ) : null}

      {project ? (
        <AppShell.Footer data-testid="layout-footer">
          <Group h="100%" px="md" justify="space-between" data-testid="layout-footer-content">
            <ProcessingStatusBar />
            <Text size="sm" data-testid="layout-footer-project-name">
              Project: {project.projectMeta.name}
            </Text>
            <Text size="sm">Subjects: {subjectCount}</Text>
          </Group>
        </AppShell.Footer>
      ) : null}

      <AppShell.Main
        ref={mainRef}
        mt="var(--app-shell-header-offset, 0px)"
        pt="md"
        pb="md"
        style={{
          height:
            "calc(100dvh - var(--app-shell-header-offset, 0px) - var(--app-shell-footer-offset, 0px))",
          minHeight: 0,
          overflowY: "auto",
        }}
        data-testid="layout-main"
      >
        <Modal
          attributes={{ close: { "data-testid": "leave-project-modal-close" } }}
          opened={leaveModalOpen}
          onClose={() => setLeaveModalOpen(false)}
          title={
            isProcessRunning
              ? leaveTarget === "exit"
                ? "Abort and exit"
                : "Abort and leave"
              : leaveTarget === "exit"
                ? "Exit application"
                : "Leave project"
          }
          centered
          data-testid="layout-leave-modal"
        >
          <Stack gap="md">
            <Text>
              {isProcessRunning
                ? leaveTarget === "exit"
                  ? "An active ExploreASL process/import is running. Exiting the application will abort the execution. Do you want to abort and exit?"
                  : "An active ExploreASL process/import is running. Leaving the project will abort the execution. Do you want to abort and leave?"
                : leaveTarget === "exit"
                  ? "Save your changes before exiting the application?"
                  : "Save your changes before leaving this project?"}
            </Text>
            <Group justify="flex-end">
              <Button
                variant="default"
                onClick={() => setLeaveModalOpen(false)}
                data-testid="layout-leave-modal-cancel-btn"
              >
                Cancel
              </Button>
              {isProcessRunning ? (
                <Button
                  color="red"
                  onClick={() => void leaveProject()}
                  data-testid="layout-leave-modal-abort-btn"
                >
                  {leaveTarget === "exit" ? "Abort and exit" : "Abort and leave"}
                </Button>
              ) : null}
            </Group>
          </Stack>
        </Modal>
        <div
          key={location.pathname}
          ref={pageRef}
          className="page-fade-container"
          data-testid="page-fade-container"
        >
          {project &&
            (["missing", "unreadable", "ambiguous"].includes(dicomSourceAvailability.status) ||
              ["missing", "unreadable", "changed"].includes(externalSourceAvailability.status)) && (
              <Alert color="yellow" mb="md" data-testid="layout-missing-source-summary">
                One or more external sources are unavailable. Use Relink in Import or Visualization;
                unaffected phases remain available.
              </Alert>
            )}
          <Outlet context={{ onOpenSettings } satisfies LayoutOutletContext} />
        </div>
      </AppShell.Main>
    </AppShell>
  );
}

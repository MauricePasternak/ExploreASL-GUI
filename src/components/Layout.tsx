import {
  ActionIcon,
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
  IconHelp,
  IconHome,
  IconPlayerPlay,
  IconSettings,
  IconUpload,
} from "@tabler/icons-react";
import { useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router";

import { canAccessPhase, type ProjectPhase } from "../schemas/project";
import { useProcessingStore } from "../stores/processingStore";
import { useProjectStore } from "../stores/projectStore";
import { logAction } from "../lib/debug";
import ProcessingStatusBar from "./processing/ProcessingStatusBar";
import PageHelpButton from "./PageHelpButton";

const PHASE_NAV = [
  { phase: "import", label: "Import", icon: IconUpload },
  { phase: "parameters", label: "Parameters", icon: IconAdjustments },
  { phase: "processing", label: "Processing", icon: IconPlayerPlay },
  { phase: "visualization", label: "Visualization", icon: IconChartScatter },
] as const;

interface LayoutProps {
  onOpenSettings: () => void;
}

export default function Layout({ onOpenSettings }: LayoutProps) {
  const [opened, { toggle, close: closeMobileNav }] = useDisclosure(false);
  const [leaveModalOpen, setLeaveModalOpen] = useState(false);
  const project = useProjectStore((state) => state.project);
  const setPhase = useProjectStore((state) => state.setPhase);
  const toggleNavbar = useProjectStore((state) => state.toggleNavbar);
  const saveProject = useProjectStore((state) => state.saveProject);
  const closeProject = useProjectStore((state) => state.closeProject);
  const navigate = useNavigate();
  const location = useLocation();

  const subjectCount = useProcessingStore((s) => {
    const subjects = new Set(s.availableSubjects.map((info) => info.subject));
    return subjects.size;
  });
  const navbarCollapsed = project?.uiState.navbarCollapsed ?? true;

  async function handlePhaseNavigation(phase: ProjectPhase) {
    if (!project || !canAccessPhase(project, phase)) {
      return;
    }

    logAction("layout_navigate_phase", { phase });
    setPhase(phase);
    await saveProject();
    navigate(`/project/${project.projectMeta.id}/${phase}`);
  }

  async function leaveProject({ saveChanges }: { saveChanges: boolean }) {
    logAction("layout_leave_project", { saveChanges });
    if (saveChanges) {
      try {
        await saveProject();
      } catch (error) {
        notifications.show({
          color: "red",
          title: "Failed to save project",
          message:
            error instanceof Error
              ? error.message
              : "ExploreASL GUI could not save your project before leaving.",
        });
        return;
      }
    }

    setLeaveModalOpen(false);
    closeMobileNav();
    navigate("/");
    closeProject();
  }

  function handleReturnHome() {
    const { project: currentProject, isDirty: currentIsDirty } = useProjectStore.getState();

    if (!currentProject) {
      navigate("/");
      return;
    }

    if (currentIsDirty) {
      setLeaveModalOpen(true);
      return;
    }

    logAction("layout_return_home");
    closeMobileNav();
    navigate("/");
    closeProject();
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
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Group gap="sm">
            {project ? (
              <Burger
                opened={opened}
                onClick={toggle}
                size="sm"
                hiddenFrom="xs"
                data-testid="layout-mobile-nav-toggle"
              />
            ) : null}
            <Image src={appLogo} alt="ExploreASL GUI" h={32} w={32} style={{ flexShrink: 0 }} />
            {project ? <Text c="dimmed">{project.projectMeta.name}</Text> : null}
          </Group>

          <Group gap="sm">
            {project ? (
              <Badge variant="light" color="blue" data-testid="layout-phase-badge">
                {project.projectMeta.currentPhase}
              </Badge>
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
                const disabled = !canAccessPhase(project, phase);
                const iconElement = (
                  <NavLink
                    key={phase}
                    active={active}
                    component="button"
                    disabled={disabled}
                    label={navbarCollapsed ? undefined : label}
                    leftSection={<Icon size={18} />}
                    onClick={() => void handlePhaseNavigation(phase)}
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
            <Text size="sm">Project: {project.projectMeta.name}</Text>
            <Text size="sm">Subjects: {subjectCount}</Text>
          </Group>
        </AppShell.Footer>
      ) : null}

      <AppShell.Main>
        <Modal
          opened={leaveModalOpen}
          onClose={() => setLeaveModalOpen(false)}
          title="Leave project"
          centered
          data-testid="layout-leave-modal"
        >
          <Stack gap="md">
            <Text>Save your changes before leaving this project?</Text>
            <Group justify="flex-end">
              <Button
                variant="default"
                onClick={() => setLeaveModalOpen(false)}
                data-testid="layout-leave-modal-cancel-btn"
              >
                Cancel
              </Button>
              <Button
                variant="light"
                color="red"
                onClick={() => void leaveProject({ saveChanges: false })}
                data-testid="layout-leave-modal-leave-without-saving-btn"
              >
                Leave without saving
              </Button>
              <Button
                onClick={() => void leaveProject({ saveChanges: true })}
                data-testid="layout-leave-modal-save-and-leave-btn"
              >
                Save and leave
              </Button>
            </Group>
          </Stack>
        </Modal>
        <Outlet />
        <PageHelpButton />
      </AppShell.Main>
    </AppShell>
  );
}

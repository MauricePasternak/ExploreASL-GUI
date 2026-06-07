import {
  ActionIcon,
  AppShell,
  Badge,
  Button,
  Burger,
  Group,
  Modal,
  NavLink,
  Stack,
  Text,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useDisclosure } from "@mantine/hooks";
import {
  IconAdjustments,
  IconHome,
  IconPlayerPlay,
  IconSettings,
  IconUpload,
} from "@tabler/icons-react";
import { useState } from "react";
import { Outlet, useNavigate } from "react-router";

import { canAccessPhase, type ProjectPhase } from "../schemas/project";
import { useProjectStore } from "../stores/projectStore";
import { logAction } from "../lib/debug";

const PHASE_NAV = [
  { phase: "import", label: "Import", icon: IconUpload },
  { phase: "parameters", label: "Parameters", icon: IconAdjustments },
  { phase: "processing", label: "Processing", icon: IconPlayerPlay },
] as const;

interface LayoutProps {
  onOpenSettings: () => void;
}

export default function Layout({ onOpenSettings }: LayoutProps) {
  const [opened, { toggle, close: closeMobileNav }] = useDisclosure(false);
  const [leaveModalOpen, setLeaveModalOpen] = useState(false);
  const project = useProjectStore((state) => state.project);
  const setPhase = useProjectStore((state) => state.setPhase);
  const saveProject = useProjectStore((state) => state.saveProject);
  const closeProject = useProjectStore((state) => state.closeProject);
  const navigate = useNavigate();

  async function handlePhaseNavigation(phase: ProjectPhase) {
    if (!project || !canAccessPhase(project.projectMeta.currentPhase, phase)) {
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
      footer={{ height: 40 }}
      navbar={{
        width: 240,
        breakpoint: "sm",
        collapsed: { desktop: !project, mobile: !opened },
      }}
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Group gap="sm">
            {project ? <Burger opened={opened} onClick={toggle} size="sm" hiddenFrom="sm" data-testid="layout-mobile-nav-toggle" /> : null}
            <Text fw={700}>ExploreASL GUI</Text>
            {project ? <Text c="dimmed">{project.projectMeta.name}</Text> : null}
          </Group>

          <Group gap="sm">
            {project ? (
              <Badge variant="light" color="blue" data-testid="layout-phase-badge">
                {project.projectMeta.currentPhase}
              </Badge>
            ) : null}
            <ActionIcon
              aria-label="Open settings"
              variant="subtle"
              color="red"
              onClick={onOpenSettings}
              data-testid="layout-open-settings-btn"
            >
              <IconSettings size={18} />
            </ActionIcon>
          </Group>
        </Group>
      </AppShell.Header>

      {project ? (
        <AppShell.Navbar p="xs">
          <Stack gap="xs" h="100%">
            <div>
              {PHASE_NAV.map(({ phase, label, icon: Icon }) => (
                <NavLink
                  key={phase}
                  active={project.projectMeta.currentPhase === phase}
                  component="button"
                  disabled={!canAccessPhase(project.projectMeta.currentPhase, phase)}
                  label={label}
                  leftSection={<Icon size={18} />}
                  onClick={() => void handlePhaseNavigation(phase)}
                  data-testid={`layout-nav-${phase}`}
                />
              ))}
            </div>
            <NavLink
              component="button"
              label="Return to home"
              leftSection={<IconHome size={18} />}
              mt="auto"
              onClick={handleReturnHome}
              data-testid="layout-nav-home"
            />
          </Stack>
        </AppShell.Navbar>
      ) : null}

      <AppShell.Footer>
        <Group h="100%" px="md" justify="space-between">
          <Text size="sm">Status: idle</Text>
          <Text size="sm">{project ? `Project: ${project.projectMeta.name}` : "Project: none"}</Text>
          <Text size="sm">Subjects: 0</Text>
        </Group>
      </AppShell.Footer>

      <AppShell.Main>
        <Modal
          opened={leaveModalOpen}
          onClose={() => setLeaveModalOpen(false)}
          title="Leave project"
          centered
        >
          <Stack gap="md">
            <Text>Save your changes before leaving this project?</Text>
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setLeaveModalOpen(false)} data-testid="layout-leave-cancel-btn">
                Cancel
              </Button>
              <Button variant="light" color="red" onClick={() => void leaveProject({ saveChanges: false })} data-testid="layout-leave-without-saving-btn">
                Leave without saving
              </Button>
              <Button onClick={() => void leaveProject({ saveChanges: true })} data-testid="layout-save-and-leave-btn">Save and leave</Button>
            </Group>
          </Stack>
        </Modal>
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
}

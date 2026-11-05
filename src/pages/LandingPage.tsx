import { useEffect, useRef, useState } from "react";
import { commands, unwrap } from "../lib/ipc";
import type { BidsCheckResult_Serialize as BidsCheckResult } from "../generated/bindings";
import { notifications } from "@mantine/notifications";
import {
  ActionIcon,
  Alert,
  Button,
  Group,
  Image,
  Menu,
  Modal,
  Paper,
  Radio,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconChevronDown,
  IconFolderOpen,
  IconKeyboard,
  IconPlus,
} from "@tabler/icons-react";
import { open } from "@tauri-apps/plugin-dialog";
import { exists } from "@tauri-apps/plugin-fs";
import { homeDir } from "@tauri-apps/api/path";
import { useNavigate, useOutletContext } from "react-router";

import { PROJECT_FILE_NAME } from "../schemas/project";
import { inspectProject } from "../lib/projectPersistence";
import { useGlobalStore } from "../stores/globalStore";
import { useProjectStore } from "../stores/projectStore";
import RecentProjectsList from "../components/landing/RecentProjectsList";
import WelcomeCard from "../components/landing/WelcomeCard";
import PathEntryButton from "../components/common/PathEntryButton";
import type { LayoutOutletContext } from "../components/Layout";
import { logAction } from "../lib/debug";
import { showErrorNotification } from "../lib/errorNotifications";
import { ProjectStorageError, projectStorageErrorMessage } from "../lib/projectPersistence";
import appLogo from "../../src-tauri/icons/easl_gui_logo.png";
import { resolveProjectIdentity, type DuplicateProjectChoice } from "../lib/projectIdentity";
import { SetupCommandErrorSchema, type SetupPlan } from "../lib/bids/setup";
import "./LandingPage.css";

const PROJECT_ACTIONS = [
  {
    id: "new",
    title: "New project",
    description: "Start with DICOM data or an existing BIDS dataset.",
    browse: "Choose folder",
    manual: "Enter folder path…",
    pathTitle: "Select project root directory",
    icon: IconPlus,
  },
  {
    id: "open",
    title: "Open project",
    description: "Continue working with a saved ExploreASL GUI project.",
    browse: "Choose project file",
    manual: "Enter project file path…",
    pathTitle: "Select project file",
    icon: IconFolderOpen,
  },
] as const;

type BidsDialogState =
  | null
  | { kind: "bids-detected"; result: BidsCheckResult }
  | { kind: "no-subjects"; result: BidsCheckResult }
  | { kind: "no-asl"; result: BidsCheckResult }
  | { kind: "corrupt-desc"; result: BidsCheckResult };

interface LandingPageProps {
  onOpenSettings?: () => void;
}

interface IdentityPrompt {
  oldPath: string;
  newPath: string;
  resolve: (choice: DuplicateProjectChoice) => void;
}

function projectErrorDetails(
  error: unknown,
  fallback = "Check that you selected project.easl from a supported version. Choose another project file or restore a working backup.",
) {
  if (error instanceof ProjectStorageError) return projectStorageErrorMessage(error);
  const setup = SetupCommandErrorSchema.safeParse(error);
  return setup.success ? setup.data.details : fallback;
}

export default function LandingPage({ onOpenSettings: onOpenSettingsProp }: LandingPageProps = {}) {
  const navigate = useNavigate();
  const outletContext = useOutletContext<LayoutOutletContext | undefined>();
  const onOpenSettings = onOpenSettingsProp ?? outletContext?.onOpenSettings ?? (() => {});
  const [loading, setLoading] = useState(false);
  const menuTargets = useRef<Record<string, HTMLButtonElement | null>>({});
  const createProject = useProjectStore((state) => state.createProject);
  const preflightProjectSetup = useProjectStore((state) => state.preflightProjectSetup);
  const loadProject = useProjectStore((state) => state.loadProject);
  const confirmRecovery = useProjectStore((state) => state.confirmRecovery);
  const declineRecovery = useProjectStore((state) => state.declineRecovery);
  const recovery = useProjectStore((state) => state.recovery);
  const addRecentProject = useGlobalStore((state) => state.addRecentProject);
  const replaceRecentProject = useGlobalStore((state) => state.replaceRecentProject);
  const executionProfiles = useGlobalStore((state) => state.settings.executionProfiles);
  const hasValidProfile = useGlobalStore((state) => state.hasValidProfile());
  const recentProjects = useGlobalStore((state) => state.settings.recentProjects);

  const showWelcomeCard = executionProfiles.length === 0;
  const projectActionsDisabled = executionProfiles.length > 0 && !hasValidProfile;

  // BIDS detection dialog state
  const [bidsDialog, setBidsDialog] = useState<BidsDialogState>(null);
  const [bidsRadioValue, setBidsRadioValue] = useState<"bids" | "dicom" | null>(null);
  // Store the selected folder path + project name for dialog actions
  const [pendingFolder, setPendingFolder] = useState<{
    path: string;
    name: string;
    requiresSetupPlan: boolean;
  } | null>(null);
  const [setupPlan, setSetupPlan] = useState<SetupPlan | null>(null);
  const [setupPlanError, setSetupPlanError] = useState<string | null>(null);
  const [setupPlanLoading, setSetupPlanLoading] = useState(false);
  const setupPlanRequest = useRef(0);
  const [identityPrompt, setIdentityPrompt] = useState<IdentityPrompt | null>(null);
  const recoveryPath = recovery?.easlPath ?? null;

  async function proceedWithProject(
    selected: string,
    projectName: string,
    dataSource: "dicom" | "bids",
    planId?: string,
  ) {
    const projectPath = `${selected}/${PROJECT_FILE_NAME}`;
    await createProject(selected, projectName, {
      dataSource,
      ...(planId === undefined ? {} : { planId }),
    });
    const project = useProjectStore.getState().project;
    addRecentProject(projectPath, project?.projectMeta.id, project?.projectMeta.name);
    logAction("landing_new_project_created", { path: selected, name: projectName, dataSource });

    if (project) {
      navigate(`/project/${project.projectMeta.id}/import`);
    }
  }

  useEffect(() => {
    if (!pendingFolder || !bidsRadioValue || !bidsDialog || !pendingFolder.requiresSetupPlan) {
      return;
    }
    const requestVersion = setupPlanRequest;
    const request = ++requestVersion.current;
    setSetupPlanLoading(true);
    setSetupPlanError(null);
    void preflightProjectSetup(pendingFolder.path, pendingFolder.name, bidsRadioValue)
      .then((plan) => {
        if (requestVersion.current === request) setSetupPlan(plan);
      })
      .catch((error: unknown) => {
        if (requestVersion.current === request) {
          console.error("[PROJECT] Setup inspection failed", error);
          setSetupPlan(null);
          setSetupPlanError(
            projectErrorDetails(
              error,
              "Project setup could not be inspected. Check directory access and free disk space, then select the directory again to retry.",
            ),
          );
        }
      })
      .finally(() => {
        if (requestVersion.current === request) setSetupPlanLoading(false);
      });
    return () => {
      // Invalidate even a response that races the effect cleanup.
      if (requestVersion.current === request) requestVersion.current++;
    };
  }, [bidsDialog, bidsRadioValue, pendingFolder, preflightProjectSetup]);

  function chooseDuplicateIdentity(oldPath: string, newPath: string) {
    return new Promise<DuplicateProjectChoice>((resolve) => {
      setIdentityPrompt({ oldPath, newPath, resolve });
    });
  }

  function resolveIdentityPrompt(choice: DuplicateProjectChoice) {
    const prompt = identityPrompt;
    if (!prompt) return;
    setIdentityPrompt(null);
    prompt.resolve(choice);
  }

  async function openProjectWithIdentity(path: string): Promise<boolean> {
    if (!useGlobalStore.getState().hasValidProfile())
      throw new Error("Cannot open a project without a valid execution profile.");
    const inspection = await inspectProject(path, recentProjects);
    if (inspection.setupRecovered)
      notifications.show({
        color: "blue",
        title: "Previous setup recovered",
        message: `Recovered ${inspection.setupRecovered} prior setup transaction(s).`,
      });
    const resolution = await resolveProjectIdentity(path, inspection, chooseDuplicateIdentity);
    if (resolution.cancelled) return false;
    await loadProject(path, { inspection, copied: resolution.copied });
    if (useProjectStore.getState().recovery?.easlPath === path) return false;
    const openedProject = useProjectStore.getState().project;
    if (openedProject) {
      if (resolution.replacePath)
        replaceRecentProject(
          resolution.replacePath,
          path,
          openedProject.projectMeta.id,
          openedProject.projectMeta.name,
        );
      else addRecentProject(path, openedProject.projectMeta.id, openedProject.projectMeta.name);
    }
    return openedProject !== null;
  }

  async function handleNewProject(selectedPath?: string) {
    setLoading(true);
    logAction("landing_new_project_start");
    let selectedDirectory: string | undefined;

    try {
      let defaultPath: string | undefined;
      if (recentProjects && recentProjects.length > 0) {
        const mostRecent = recentProjects[0].path;
        const parentDir = mostRecent.replace(/[/\\][^/\\]+$/, "");
        if (await exists(parentDir)) {
          defaultPath = parentDir;
        }
      }
      if (!defaultPath) {
        try {
          defaultPath = await homeDir();
        } catch (err) {
          console.error("Failed to get home directory:", err);
        }
      }

      const selected =
        selectedPath ??
        (await open({
          directory: true,
          multiple: false,
          title: "Select Project Root Directory",
          defaultPath,
        }));

      if (typeof selected !== "string") {
        logAction("landing_new_project_cancelled");
        return;
      }
      selectedDirectory = selected;

      const projectName = selected.split(/[/\\]/).filter(Boolean).pop() ?? "Untitled";
      const projectPath = `${selected}/${PROJECT_FILE_NAME}`;
      const writable = await commands.isWritable(selected);
      if (!writable) {
        showErrorNotification({
          id: `project-create:${selected}`,
          title: "Directory not writable",
          message: "The selected directory does not allow project creation.",
          details: "Check directory permissions or choose another project directory.",
        });
        logAction("landing_new_project_error", { reason: "not_writable", path: selected });
        return;
      }

      // Selection settles prior setup before inspection or new plan review.
      const bidsResult = await unwrap(commands.checkBidsDataset(selected));
      if (bidsResult.setupRecovered) {
        notifications.show({
          title: "Prior setup recovered",
          message: `Recovered ${bidsResult.setupRecovered} prior setup transaction(s) in ${selected}. No new setup changes were authorized.`,
          color: "yellow",
          autoClose: false,
        });
      }
      if (await exists(projectPath)) {
        showErrorNotification({
          id: `project-create:${selected}`,
          title: "Project exists",
          message: "An ExploreASL GUI project already exists in the selected directory.",
          details: "Use Open Project to open it, or choose another directory for a new project.",
        });
        logAction("landing_new_project_error", { reason: "exists", path: selected });
        return;
      }

      setPendingFolder({
        path: selected,
        name: projectName,
        // A DICOM project in an ordinary non-BIDS folder retains its existing
        // single-file create/save contract. DICOM selected on a detected BIDS
        // root uses the reviewed native transaction.
        requiresSetupPlan:
          bidsResult.isBids ||
          bidsResult.totalSubjectCount > 0 ||
          bidsResult.hasDatasetDescription ||
          bidsResult.datasetDescError !== null,
      });
      setSetupPlan(null);
      setSetupPlanError(null);

      // Route to appropriate dialog
      if (bidsResult.datasetDescError != null && bidsResult.aslSubjectCount >= 1) {
        logAction("landing_bids_corrupt_desc", { aslSubjectCount: bidsResult.aslSubjectCount });
        setBidsRadioValue("bids");
        setBidsDialog({ kind: "corrupt-desc", result: bidsResult });
      } else if (bidsResult.error == null && bidsResult.isBids) {
        logAction("landing_bids_detected", {
          aslSubjectCount: bidsResult.aslSubjectCount,
          aslSessionCount: bidsResult.aslSessionCount,
          bidsVersion: bidsResult.bidsVersion,
        });
        setBidsRadioValue(null);
        setBidsDialog({ kind: "bids-detected", result: bidsResult });
      } else if (
        !bidsResult.isBids &&
        bidsResult.aslSubjectCount === 0 &&
        bidsResult.totalSubjectCount === 0
      ) {
        logAction("landing_bids_no_subjects");
        setBidsRadioValue("dicom");
        setBidsDialog({ kind: "no-subjects", result: bidsResult });
      } else if (
        !bidsResult.isBids &&
        bidsResult.aslSubjectCount === 0 &&
        bidsResult.totalSubjectCount > 0
      ) {
        logAction("landing_bids_no_asl", { totalSubjectCount: bidsResult.totalSubjectCount });
        setBidsRadioValue("dicom");
        setBidsDialog({ kind: "no-asl", result: bidsResult });
      } else if (bidsResult.error != null && bidsResult.isBids) {
        // Defensive: spec implies this state is unreachable (a BIDS dataset
        // with ASL subjects but a non-null `error`). If the Rust layer ever
        // emits it, surface a non-fatal corrupt-desc warning rather than
        // silently creating a DICOM project over a BIDS folder.
        logAction("landing_bids_defensive_corrupt_desc", {
          error: bidsResult.error,
          aslSubjectCount: bidsResult.aslSubjectCount,
        });
        setBidsRadioValue("bids");
        setBidsDialog({ kind: "corrupt-desc", result: bidsResult });
      } else {
        setBidsRadioValue("dicom");
        setBidsDialog({ kind: "no-subjects", result: bidsResult });
      }
    } catch (error) {
      showErrorNotification({
        id: `project-create:${selectedDirectory ?? "selection"}`,
        title: "Failed to create project",
        message: "Project files could not be initialized in the selected directory.",
        details: projectErrorDetails(
          error,
          "Check directory access and free disk space, then try again.",
        ),
        error,
      });
      logAction("landing_new_project_error", { reason: "exception" });
    } finally {
      setLoading(false);
    }
  }

  const getModalTestId = () => {
    if (!bidsDialog) return "";
    switch (bidsDialog.kind) {
      case "bids-detected":
        return "bids-detection-dialog";
      case "no-subjects":
        return "bids-no-subjects-dialog";
      case "no-asl":
        return "bids-no-asl-dialog";
      case "corrupt-desc":
        return "bids-corrupt-desc-dialog";
    }
  };

  const getModalTitle = () => {
    if (!bidsDialog) return "";
    switch (bidsDialog.kind) {
      case "bids-detected":
        return "Use this existing ASL dataset?";
      case "no-subjects":
        return "Set up a DICOM import";
      case "no-asl":
        return "No usable BIDS ASL images found";
      case "corrupt-desc":
        return "Dataset information needs attention";
    }
  };

  const getCancelTestId = () => {
    if (!bidsDialog) return "";
    switch (bidsDialog.kind) {
      case "bids-detected":
        return "bids-detection-dialog-cancel-btn";
      case "no-subjects":
        return "bids-no-subjects-cancel-btn";
      case "no-asl":
        return "bids-no-asl-cancel-btn";
      case "corrupt-desc":
        return "bids-corrupt-desc-cancel-btn";
    }
  };

  const getChooseTestId = () => {
    if (!bidsDialog) return "";
    switch (bidsDialog.kind) {
      case "bids-detected":
        return "bids-detection-dialog-choose-btn";
      case "no-subjects":
        return "bids-no-subjects-choose-btn";
      case "no-asl":
        return "bids-no-asl-choose-btn";
      case "corrupt-desc":
        return "bids-corrupt-desc-choose-btn";
    }
  };

  const getConfirmTestId = () => {
    if (!bidsDialog) return "";
    switch (bidsDialog.kind) {
      case "bids-detected":
        return "bids-detection-dialog-continue-btn";
      case "no-subjects":
        return "bids-no-subjects-confirm-btn";
      case "no-asl":
        return "bids-no-asl-confirm-btn";
      case "corrupt-desc":
        return "bids-corrupt-desc-skip-btn";
    }
  };

  function handleDialogCancel() {
    setupPlanRequest.current++;
    setBidsDialog(null);
    setBidsRadioValue(null);
    setPendingFolder(null);
    setSetupPlan(null);
    setSetupPlanError(null);
    logAction("landing_bids_dialog_cancelled");
  }

  async function handleConfirm() {
    if (
      !bidsRadioValue ||
      !pendingFolder ||
      (pendingFolder.requiresSetupPlan &&
        (!setupPlan ||
          setupPlanLoading ||
          setupPlan.mode !== bidsRadioValue ||
          setupPlan.conflicts.length > 0))
    )
      return;
    const dataSource = bidsRadioValue === "bids" ? "bids" : "dicom";
    logAction("landing_bids_detect_continue", { dataSource });
    const { path, name } = pendingFolder;
    setLoading(true);
    try {
      await proceedWithProject(path, name, dataSource, setupPlan?.planId);
      setBidsDialog(null);
      setBidsRadioValue(null);
      setPendingFolder(null);
      setSetupPlan(null);
    } catch (error) {
      showErrorNotification({
        id: `project-create:${path}`,
        title: "Failed to create project",
        message: "Project files could not be initialized in the selected directory.",
        details: projectErrorDetails(
          error,
          "Check directory access and free disk space. Cancel setup and select the directory again to review a fresh plan before retrying.",
        ),
        error,
      });
    } finally {
      setLoading(false);
    }
  }

  async function handleNoBidsChooseDifferent() {
    logAction("landing_bids_choose_different");
    setupPlanRequest.current++;
    setBidsDialog(null);
    setBidsRadioValue(null);
    setPendingFolder(null);
    setSetupPlan(null);
    setSetupPlanError(null);
    // Re-trigger the new project flow (reopens folder picker)
    await handleNewProject();
  }

  async function handleOpenProject(selectedPath?: string) {
    setLoading(true);
    logAction("landing_open_project_start");

    try {
      let defaultPath: string | undefined;
      if (recentProjects && recentProjects.length > 0) {
        const mostRecent = recentProjects[0].path;
        if (await exists(mostRecent)) {
          defaultPath = mostRecent;
        } else {
          const parentDir = mostRecent.replace(/[/\\][^/\\]+$/, "");
          if (await exists(parentDir)) {
            defaultPath = parentDir;
          }
        }
      }
      if (!defaultPath) {
        try {
          defaultPath = await homeDir();
        } catch (err) {
          console.error("Failed to get home directory:", err);
        }
      }

      const selected =
        selectedPath ??
        (await open({
          filters: [{ name: "ExploreASL Project", extensions: ["easl"] }],
          multiple: false,
          title: "Open Project File",
          defaultPath,
        }));

      if (typeof selected !== "string") {
        logAction("landing_open_project_cancelled");
        return;
      }

      try {
        if (!(await openProjectWithIdentity(selected))) return;
      } catch (error) {
        showErrorNotification({
          id: `project-open:${selected}`,
          title: "Invalid project file",
          message: "The selected project could not be opened.",
          details: projectErrorDetails(error),
          error,
        });
        logAction("landing_open_project_error", { path: selected, reason: "invalid_file" });
        return;
      }
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
      if (!(await openProjectWithIdentity(path))) return;
      logAction("landing_open_recent_success", { path });

      const project = useProjectStore.getState().project;
      if (project) {
        navigate(`/project/${project.projectMeta.id}/${project.projectMeta.currentPhase}`);
      }
    } catch (error) {
      showErrorNotification({
        id: `project-open:${path}`,
        title: "Invalid project file",
        message: "The selected project could not be opened.",
        details: projectErrorDetails(error),
        error,
      });
      logAction("landing_open_recent_error", { path });
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirmRecovery() {
    if (!recoveryPath) return;
    setLoading(true);
    try {
      await confirmRecovery();
      const project = useProjectStore.getState().project;
      addRecentProject(recoveryPath, project?.projectMeta.id, project?.projectMeta.name);
      if (project)
        navigate(`/project/${project.projectMeta.id}/${project.projectMeta.currentPhase}`);
    } catch (error) {
      showErrorNotification({
        id: `project-recovery:${recoveryPath}`,
        title: "Recovery failed",
        message: "The project backup could not be opened.",
        details: projectErrorDetails(error),
        error,
      });
    } finally {
      setLoading(false);
    }
  }

  function handleDeclineRecovery() {
    declineRecovery();
  }

  return (
    <div className="landing-page" data-testid="landing-page">
      <header className="landing-hero" data-testid="landing-hero">
        <div className="landing-hero-content" data-testid="landing-hero-content">
          <Image src={appLogo} alt="ExploreASL Logo" data-testid="landing-logo" />
          <div data-testid="landing-hero-text-container">
            <Title order={1} data-testid="landing-hero-title">
              Welcome to ExploreASL
            </Title>
            <Text data-testid="landing-hero-subtitle">
              Your workspace for arterial spin labeling MRI.
            </Text>
          </div>
        </div>
      </header>

      <div className="landing-body" data-testid="landing-body-container">
        <Stack gap="xl" data-testid="landing-body-stack">
          {showWelcomeCard ? (
            <WelcomeCard onOpenSettings={onOpenSettings} />
          ) : (
            <>
              {projectActionsDisabled ? (
                <Alert
                  color="red"
                  icon={<IconAlertTriangle size={16} />}
                  title="Execution profiles need attention"
                  data-testid="landing-invalid-profiles-alert"
                >
                  All execution profiles are invalid. Fix a profile in Settings.
                </Alert>
              ) : null}

              <section
                className="landing-actions"
                aria-label="Create or open a project"
                data-testid="landing-actions-group"
              >
                {PROJECT_ACTIONS.map((action) => {
                  const Icon = action.icon;
                  const onSelect = action.id === "new" ? handleNewProject : handleOpenProject;
                  const variant = action.id === "new" ? "filled" : "default";
                  return (
                    <Paper
                      component="article"
                      withBorder
                      radius="md"
                      className="landing-action-card"
                      key={action.id}
                      data-testid={`landing-${action.id}-project-card`}
                    >
                      <ThemeIcon
                        variant="light"
                        size={44}
                        radius="md"
                        data-testid={`landing-${action.id}-project-icon`}
                      >
                        <Icon size={23} stroke={1.7} aria-hidden="true" />
                      </ThemeIcon>
                      <Title order={2} data-testid={`landing-${action.id}-project-heading`}>
                        {action.title}
                      </Title>
                      <Text size="sm" data-testid={`landing-${action.id}-project-description`}>
                        {action.description}
                      </Text>
                      <div
                        className="landing-split"
                        role="group"
                        aria-label={`${action.title} options`}
                        data-testid={`landing-${action.id}-project-options`}
                      >
                        <Button
                          size="md"
                          radius="md"
                          variant={variant}
                          className="landing-browse"
                          leftSection={<IconFolderOpen size={18} aria-hidden="true" />}
                          loading={loading}
                          disabled={projectActionsDisabled}
                          aria-label={`${action.title}: ${action.browse.toLowerCase()}`}
                          onClick={() => void onSelect()}
                          data-testid={`landing-${action.id}-project-btn`}
                        >
                          {action.browse}
                        </Button>
                        <PathEntryButton
                          title={action.pathTitle}
                          testId={`landing-${action.id}-project-path`}
                          extensions={action.id === "open" ? ["easl"] : undefined}
                          disabled={projectActionsDisabled || loading}
                          onSelect={onSelect}
                          renderTrigger={(openPath) => (
                            <Menu position="bottom-end" withinPortal>
                              <Menu.Target>
                                <ActionIcon
                                  ref={(node) => {
                                    menuTargets.current[action.id] = node;
                                  }}
                                  size={44}
                                  radius="md"
                                  variant={variant}
                                  className="landing-more"
                                  disabled={projectActionsDisabled || loading}
                                  aria-label={`More ways to ${action.id === "new" ? "create" : "open"} a project`}
                                  title={action.manual}
                                  data-testid={`landing-${action.id}-project-more`}
                                >
                                  <IconChevronDown size={18} aria-hidden="true" />
                                </ActionIcon>
                              </Menu.Target>
                              <Menu.Dropdown data-testid={`landing-${action.id}-project-menu`}>
                                <Menu.Item
                                  leftSection={<IconKeyboard size={17} aria-hidden="true" />}
                                  disabled={projectActionsDisabled || loading}
                                  onClick={() => {
                                    // Return to the persistent trigger, not an unmounted menu item.
                                    menuTargets.current[action.id]?.focus();
                                    openPath();
                                  }}
                                  data-testid={`landing-${action.id}-project-path`}
                                >
                                  {action.manual}
                                </Menu.Item>
                              </Menu.Dropdown>
                            </Menu>
                          )}
                        />
                      </div>
                    </Paper>
                  );
                })}
              </section>

              <section
                className="landing-recent"
                aria-labelledby="landing-recent-title"
                data-testid="landing-recent-projects"
              >
                <Title
                  order={2}
                  size="h4"
                  id="landing-recent-title"
                  mb="sm"
                  data-testid="landing-recent-projects-title"
                >
                  Recent projects
                </Title>
                <RecentProjectsList
                  onOpen={handleOpenRecent}
                  disabled={projectActionsDisabled || loading}
                  data-testid="landing-recent-projects-list"
                />
              </section>
            </>
          )}
        </Stack>
      </div>

      <Modal
        opened={identityPrompt !== null}
        onClose={() => resolveIdentityPrompt("cancel")}
        title="Project identity already exists"
        centered
        data-testid="project-identity-dialog"
        attributes={{ close: { "data-testid": "project-identity-dialog-close" } }}
        transitionProps={{ duration: 0, exitDuration: 0 }}
      >
        <Stack gap="md">
          <Text size="sm">
            This project ID is already known at another available path. Is the selected project the
            moved original or a copied project?
          </Text>
          {identityPrompt && (
            <Stack gap={4}>
              <Text size="xs">Known: {identityPrompt.oldPath}</Text>
              <Text size="xs">Selected: {identityPrompt.newPath}</Text>
            </Stack>
          )}
          <Group justify="flex-end">
            <Button
              variant="default"
              onClick={() => resolveIdentityPrompt("cancel")}
              data-testid="project-identity-cancel-btn"
            >
              Cancel
            </Button>
            <Button
              variant="light"
              onClick={() => resolveIdentityPrompt("moved")}
              data-testid="project-identity-moved-btn"
            >
              Moved
            </Button>
            <Button
              onClick={() => resolveIdentityPrompt("copied")}
              data-testid="project-identity-copied-btn"
            >
              Copied
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={recoveryPath !== null}
        onClose={handleDeclineRecovery}
        title="Recovered project available"
        centered
        data-testid="project-recovery-dialog"
        attributes={{ close: { "data-testid": "project-recovery-dialog-close" } }}
        transitionProps={{ duration: 0, exitDuration: 0 }}
      >
        <Stack gap="md">
          <Alert
            color="yellow"
            icon={<IconAlertTriangle size={16} />}
            data-testid="project-recovery-alert"
          >
            The primary project file is missing or malformed. A valid backup is available.
          </Alert>
          <Text size="sm">Open the backup in memory? It will not modify files until you save.</Text>
          <Group justify="flex-end">
            <Button
              variant="default"
              onClick={handleDeclineRecovery}
              data-testid="project-recovery-decline-btn"
            >
              Cancel
            </Button>
            <Button
              loading={loading}
              onClick={handleConfirmRecovery}
              data-testid="project-recovery-confirm-btn"
            >
              Open recovered copy
            </Button>
          </Group>
        </Stack>
      </Modal>

      {/* ===== Unified BIDS/DICOM Detection Dialog ===== */}
      <Modal
        opened={bidsDialog !== null}
        onClose={handleDialogCancel}
        title={getModalTitle()}
        centered
        size={720}
        data-testid={getModalTestId()}
        attributes={{ close: { "data-testid": `${getModalTestId()}-close` } }}
        transitionProps={{ duration: 0, exitDuration: 0 }}
      >
        {bidsDialog && (
          <Stack gap="md">
            <Stack gap={4} data-testid="bids-dataset-summary">
              <Text fw={600} style={{ overflowWrap: "anywhere" }} data-testid="bids-dataset-name">
                {pendingFolder?.name}
              </Text>
              {bidsDialog.result.aslSubjectCount > 0 && (
                <Text size="sm" data-testid="bids-dataset-counts">
                  Found ASL images for {bidsDialog.result.aslSubjectCount} participant
                  {bidsDialog.result.aslSubjectCount === 1 ? "" : "s"} ·{" "}
                  {bidsDialog.result.aslSessionCount} imaging session
                  {bidsDialog.result.aslSessionCount === 1 ? "" : "s"}.
                </Text>
              )}
            </Stack>

            {bidsDialog.kind === "no-subjects" && (
              <Alert color="blue" data-testid="bids-no-subjects-notice">
                No existing BIDS ASL dataset was found in this folder. You can import original
                scanner files (DICOM), or choose another folder containing BIDS images.
              </Alert>
            )}

            {bidsDialog.kind === "no-asl" && (
              <Alert color="blue" data-testid="bids-no-asl-notice">
                Participant folders were found, but no ASL images with the required scan information
                were detected. Choose another BIDS folder, or import original scanner files (DICOM).
              </Alert>
            )}

            {bidsDialog.kind === "corrupt-desc" && (
              <Alert
                color="yellow"
                title="Dataset description could not be read"
                icon={<IconAlertTriangle size={16} />}
                data-testid="bids-description-warning"
              >
                The dataset information file (dataset_description.json) could not be read, but ASL
                images were found. You can continue to review the scans; this does not repair that
                file.
              </Alert>
            )}

            {bidsDialog.result.missingAslcontextCount > 0 && (
              <Alert
                color="yellow"
                title="Some scans are missing label/control information"
                icon={<IconAlertTriangle size={16} />}
                data-testid="bids-missing-context-warning"
              >
                {bidsDialog.result.missingAslcontextCount} ASL run
                {bidsDialog.result.missingAslcontextCount === 1 ? " is" : "s are"} missing
                label/control information (*_aslcontext.tsv). Affected participant sessions will be
                excluded from BIDS scan review.
              </Alert>
            )}

            <Radio.Group
              label="Which images would you like to use?"
              data-testid="bids-detection-source-group"
              value={bidsRadioValue ?? ""}
              onChange={(val) => {
                setSetupPlan(null);
                setSetupPlanError(null);
                setBidsRadioValue(val as "bids" | "dicom");
              }}
            >
              <Stack gap="md" mt="sm" data-testid="bids-detection-source-options">
                <Radio
                  value="bids"
                  label={
                    bidsDialog.kind === "bids-detected"
                      ? "Use existing BIDS images — Recommended"
                      : "Use existing BIDS images"
                  }
                  description={
                    bidsDialog.kind === "no-subjects" || bidsDialog.kind === "no-asl"
                      ? "No usable BIDS ASL images were found in this folder."
                      : "Use the images already organised in this folder. No DICOM conversion is needed. Next, review scan information before choosing processing settings."
                  }
                  styles={{
                    label: { fontWeight: 600 },
                    description: {
                      fontSize: "var(--mantine-font-size-sm)",
                      color: "var(--mantine-color-text)",
                    },
                  }}
                  disabled={bidsDialog.kind === "no-subjects" || bidsDialog.kind === "no-asl"}
                  data-testid="bids-detection-dialog-skip-radio"
                />
                <Radio
                  value="dicom"
                  label="Import original scanner files (DICOM)"
                  description="Convert original scanner files instead of using existing BIDS images. You will select those files next; conversion does not start here."
                  styles={{
                    label: { fontWeight: 600 },
                    description: {
                      fontSize: "var(--mantine-font-size-sm)",
                      color: "var(--mantine-color-text)",
                    },
                  }}
                  data-testid="bids-detection-dialog-dicom-radio"
                />
              </Stack>
            </Radio.Group>

            <Stack gap="xs" data-testid="bids-setup-overview">
              <Text size="sm" fw={600} data-testid="bids-setup-overview-title">
                What will change?
              </Text>
              <Text size="sm" data-testid="bids-setup-overview-description">
                ExploreASL will save project settings in this folder and prepare any required
                support files. Existing images and documentation remain unchanged during setup.
              </Text>
            </Stack>

            {pendingFolder?.requiresSetupPlan && setupPlanLoading && (
              <Text size="sm" data-testid="bids-setup-plan-loading">
                Checking required setup changes…
              </Text>
            )}
            {pendingFolder?.requiresSetupPlan && setupPlanError && (
              <Alert color="red" data-testid="bids-setup-plan-error">
                {setupPlanError}
              </Alert>
            )}
            {pendingFolder?.requiresSetupPlan && setupPlan && (
              <Stack gap="xs" data-testid="bids-setup-plan">
                {setupPlan.warnings.map((warning) => (
                  <Alert
                    key={warning}
                    color="yellow"
                    title="Please review before continuing"
                    data-testid="bids-setup-warning"
                  >
                    {warning}
                  </Alert>
                ))}
                {setupPlan.conflicts.map((conflict) => (
                  <Alert
                    key={conflict}
                    color="red"
                    title="Project setup is blocked"
                    data-testid="bids-setup-conflict"
                  >
                    {conflict}
                  </Alert>
                ))}
                <details
                  data-testid="bids-setup-details"
                  style={{ fontSize: "var(--mantine-font-size-sm)" }}
                >
                  <summary data-testid="bids-setup-details-toggle" style={{ cursor: "pointer" }}>
                    Technical details: planned file changes
                  </summary>
                  <Stack
                    gap="sm"
                    mt="sm"
                    style={{ overflowWrap: "anywhere" }}
                    data-testid="bids-setup-details-content"
                  >
                    <Text size="sm" data-testid="bids-setup-root">
                      Folder: {setupPlan.rootPath}
                    </Text>
                    {setupPlan.projectSummary && (
                      <Text size="sm" data-testid="bids-setup-project-summary">
                        Project {setupPlan.projectSummary.name} · schema{" "}
                        {setupPlan.projectSummary.schemaVersion} · hash{" "}
                        {setupPlan.projectSummary.contentHash} · ID{" "}
                        {setupPlan.projectSummary.projectId} · {setupPlan.projectSummary.dataSource}
                      </Text>
                    )}
                    {setupPlan.preservesReadme && (
                      <Text size="sm" data-testid="bids-setup-readme-notice">
                        rawdata/README.md is preserved.
                      </Text>
                    )}
                    {setupPlan.operations.map((operation) => (
                      <Stack
                        gap={2}
                        key={operation.path}
                        data-testid={`bids-setup-operation-${operation.path.replace(/[/.]/g, "-")}`}
                      >
                        <Text size="sm">
                          <strong>
                            {operation.operation === "no_op" ? "no-op" : operation.operation}
                          </strong>{" "}
                          {operation.path}
                        </Text>
                        {operation.textPreview !== undefined && operation.textPreview !== null && (
                          <Text
                            ff="monospace"
                            size="sm"
                            style={{ whiteSpace: "pre-wrap" }}
                            data-testid={`bids-setup-operation-preview-${operation.path.replace(/[/.]/g, "-")}`}
                          >
                            {operation.textPreview}
                          </Text>
                        )}
                      </Stack>
                    ))}
                    <Text size="sm" data-testid="bids-setup-temporary-artifacts">
                      {setupPlan.temporaryArtifacts.join(" ")}
                    </Text>
                  </Stack>
                </details>
              </Stack>
            )}

            <Stack gap="sm" py="sm" data-testid="bids-detection-footer">
              <Text size="sm" data-testid="bids-setup-consent-notice">
                Nothing changes until you select Create project.
              </Text>
              <Group justify="flex-end" gap="sm" data-testid="bids-detection-actions">
                <Button
                  variant="default"
                  onClick={handleDialogCancel}
                  data-testid={getCancelTestId()}
                >
                  Cancel
                </Button>
                <Button
                  variant="default"
                  onClick={handleNoBidsChooseDifferent}
                  data-testid={getChooseTestId()}
                >
                  Choose another folder
                </Button>
                <Button
                  disabled={
                    !bidsRadioValue ||
                    (pendingFolder?.requiresSetupPlan &&
                      (!setupPlan ||
                        setupPlanLoading ||
                        setupPlan.mode !== bidsRadioValue ||
                        setupPlan.conflicts.length > 0))
                  }
                  onClick={handleConfirm}
                  data-testid={getConfirmTestId()}
                >
                  Create project
                </Button>
              </Group>
            </Stack>
          </Stack>
        )}
      </Modal>
    </div>
  );
}

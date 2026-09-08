import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { notifications } from "@mantine/notifications";
import { Button, Divider, Group, Image, Modal, Radio, Stack, Text, Alert } from "@mantine/core";
import { IconAlertTriangle, IconFolderOpen, IconPlus } from "@tabler/icons-react";
import { open } from "@tauri-apps/plugin-dialog";
import { exists, readTextFile } from "@tauri-apps/plugin-fs";
import { homeDir } from "@tauri-apps/api/path";
import { useNavigate, useOutletContext } from "react-router";

import { parseProject, PROJECT_FILE_NAME } from "../schemas/project";
import { useGlobalStore } from "../stores/globalStore";
import { useProjectStore } from "../stores/projectStore";
import RecentProjectsList from "../components/landing/RecentProjectsList";
import WelcomeCard from "../components/landing/WelcomeCard";
import type { LayoutOutletContext } from "../components/Layout";
import { logAction } from "../lib/debug";
import { ProjectStorageError, projectStorageErrorMessage } from "../lib/projectPersistence";
import appLogo from "../../src-tauri/icons/easl_gui_logo.png";
import { resolveProjectIdentity, type DuplicateProjectChoice } from "../lib/projectIdentity";
import type { SetupPlan } from "../lib/bids/setup";

/** Shape returned by the Rust `check_bids_dataset` command. */
interface BidsCheckResult {
  isBids: boolean;
  hasDatasetDescription: boolean;
  datasetDescError: string | null;
  bidsVersion: string | null;
  aslSubjectCount: number;
  aslSessionCount: number;
  totalSubjectCount: number;
  missingSidecars: string[];
  missingAslcontextCount: number;
  hasPerfDirectory: boolean;
  isCrossSectional: boolean;
  error: string | null;
}

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

export default function LandingPage({ onOpenSettings: onOpenSettingsProp }: LandingPageProps = {}) {
  const navigate = useNavigate();
  const outletContext = useOutletContext<LayoutOutletContext | undefined>();
  const onOpenSettings = onOpenSettingsProp ?? outletContext?.onOpenSettings ?? (() => {});
  const [loading, setLoading] = useState(false);
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

  function showError(title: string, message: string) {
    notifications.show({
      color: "red",
      title,
      message,
      autoClose: 10000,
    });
  }

  function storageErrorMessage(error: unknown) {
    if (error instanceof ProjectStorageError) {
      return projectStorageErrorMessage(error);
    }
    return "Failed to open project. The file may be corrupted or from a newer version.";
  }

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
    addRecentProject(projectPath, project?.projectMeta.id);
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
          setSetupPlan(null);
          setSetupPlanError(
            error instanceof Error ? error.message : "Could not inspect project setup.",
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
    let candidateId: string | null = null;
    try {
      candidateId = parseProject(await readTextFile(path)).projectMeta.id;
    } catch {
      await loadProject(path);
    }

    if (candidateId) {
      const resolution = await resolveProjectIdentity(path, candidateId, recentProjects, {
        chooseDuplicate: chooseDuplicateIdentity,
      });
      if (resolution.status === "cancelled") return false;

      await loadProject(path, {
        ...(resolution.projectId !== candidateId
          ? { projectIdOverride: resolution.projectId }
          : {}),
        forceDirty: resolution.dirty,
      });
      if (useProjectStore.getState().recovery?.easlPath === path) return false;

      if (resolution.recentAction.kind === "replace") {
        replaceRecentProject(resolution.recentAction.oldPath, path, resolution.projectId);
      } else {
        addRecentProject(path, resolution.projectId);
      }
      return true;
    }

    if (useProjectStore.getState().recovery?.easlPath === path) return false;
    const openedProject = useProjectStore.getState().project;
    if (openedProject) addRecentProject(path, openedProject.projectMeta.id);
    return openedProject !== null;
  }

  async function handleNewProject() {
    setLoading(true);
    logAction("landing_new_project_start");

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

      const selected = await open({
        directory: true,
        multiple: false,
        title: "Select Project Root Directory",
        defaultPath,
      });

      if (typeof selected !== "string") {
        logAction("landing_new_project_cancelled");
        return;
      }

      const projectName = selected.split(/[/\\]/).filter(Boolean).pop() ?? "Untitled";
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

      // Invoke BIDS detection before creating the project
      const bidsResult = (await invoke("check_bids_dataset", {
        rootPath: selected,
      })) as BidsCheckResult;

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
      showError(
        "Failed to create project",
        error instanceof ProjectStorageError
          ? storageErrorMessage(error)
          : "ExploreASL GUI could not initialize the project files in the selected directory.",
      );
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
        return "BIDS Dataset Detected";
      case "no-subjects":
        return "No BIDS Subjects Found";
      case "no-asl":
        return "No Valid ASL BIDS Data Found";
      case "corrupt-desc":
        return "Corrupt dataset_description.json";
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

  const getConfirmLabel = () => {
    if (!bidsDialog) return "";
    if (bidsDialog.kind === "corrupt-desc" && bidsRadioValue === "bids") {
      return "Skip Import anyway";
    }
    if (bidsDialog.kind === "bids-detected") {
      return "Continue";
    }
    return "Confirm";
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
      showError(
        "Failed to create project",
        error instanceof ProjectStorageError
          ? storageErrorMessage(error)
          : "ExploreASL GUI could not initialize the project files in the selected directory.",
      );
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

  async function handleOpenProject() {
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

      const selected = await open({
        filters: [{ name: "ExploreASL Project", extensions: ["easl"] }],
        multiple: false,
        title: "Open Project File",
        defaultPath,
      });

      if (typeof selected !== "string") {
        logAction("landing_open_project_cancelled");
        return;
      }

      try {
        if (!(await openProjectWithIdentity(selected))) return;
      } catch (error) {
        showError("Invalid project file", storageErrorMessage(error));
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
      showError("Invalid project file", storageErrorMessage(error));
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
      addRecentProject(recoveryPath, project?.projectMeta.id);
      if (project)
        navigate(`/project/${project.projectMeta.id}/${project.projectMeta.currentPhase}`);
    } catch (error) {
      showError("Recovery failed", storageErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }

  function handleDeclineRecovery() {
    declineRecovery();
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

              {/* Action Buttons — centred */}
              <Group justify="center" data-testid="landing-actions-group">
                <Button
                  size="lg"
                  leftSection={<IconPlus size={20} />}
                  loading={loading}
                  disabled={projectActionsDisabled}
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
                  disabled={projectActionsDisabled}
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
                disabled={projectActionsDisabled}
                data-testid="landing-recent-projects-list"
              />
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
        data-testid={getModalTestId()}
        transitionProps={{ duration: 0, exitDuration: 0 }}
      >
        {bidsDialog && (
          <Stack gap="md">
            <Text size="sm">
              Select the data source structure for this project. ExploreASL GUI can configure the
              project for direct BIDS metadata review or a new DICOM import.
            </Text>

            <Radio.Group
              value={bidsRadioValue ?? ""}
              onChange={(val) => {
                setSetupPlan(null);
                setSetupPlanError(null);
                setBidsRadioValue(val as "bids" | "dicom");
              }}
            >
              <Stack gap="sm">
                <Radio
                  value="bids"
                  label="Skip Import — review BIDS metadata"
                  disabled={bidsDialog.kind === "no-subjects" || bidsDialog.kind === "no-asl"}
                  data-testid="bids-detection-dialog-skip-radio"
                />
                <Radio
                  value="dicom"
                  label="Import from DICOM"
                  data-testid="bids-detection-dialog-dicom-radio"
                />
              </Stack>
            </Radio.Group>

            {/* Case-specific helper text & alerts */}
            {bidsDialog.kind === "bids-detected" && (
              <Stack gap="xs" style={{ paddingLeft: 24 }}>
                <Text size="xs" c="dimmed">
                  The selected folder contains a BIDS-formatted dataset with ASL data.
                </Text>
                <Text size="xs" c="dimmed">
                  <strong>ASL subjects:</strong> {bidsDialog.result.aslSubjectCount} |{" "}
                  <strong>ASL sessions:</strong> {bidsDialog.result.aslSessionCount} |{" "}
                  <strong>Cross-sectional:</strong>{" "}
                  {bidsDialog.result.isCrossSectional ? "Yes" : "No"}
                </Text>
                {bidsDialog.result.missingAslcontextCount > 0 && (
                  <Alert
                    color="yellow"
                    icon={<IconAlertTriangle size={16} />}
                    py="xs"
                    style={{ fontSize: "12px" }}
                  >
                    {bidsDialog.result.missingAslcontextCount} session
                    {bidsDialog.result.missingAslcontextCount > 1 ? "s" : ""} will be skipped during
                    review due to missing{" "}
                    <Text span ff="monospace" size="xs">
                      *_aslcontext.tsv
                    </Text>{" "}
                    files.
                  </Alert>
                )}
                <Text size="xs" c="dimmed">
                  Review exact setup changes before confirmation. Nothing is written during this
                  review.
                </Text>
              </Stack>
            )}

            {pendingFolder?.requiresSetupPlan && (
              <Divider label="Reviewed setup changes" labelPosition="center" />
            )}
            {pendingFolder?.requiresSetupPlan && setupPlanLoading && (
              <Text data-testid="bids-setup-plan-loading">Loading setup plan…</Text>
            )}
            {pendingFolder?.requiresSetupPlan && setupPlanError && (
              <Alert color="red" data-testid="bids-setup-plan-error">
                {setupPlanError}
              </Alert>
            )}
            {pendingFolder?.requiresSetupPlan && setupPlan && (
              <Stack gap="xs" data-testid="bids-setup-plan">
                {setupPlan.projectSummary && (
                  <Text size="xs" data-testid="bids-setup-project-summary">
                    Project {setupPlan.projectSummary.name} · schema{" "}
                    {setupPlan.projectSummary.schemaVersion} · hash{" "}
                    {setupPlan.projectSummary.contentHash} · ID {setupPlan.projectSummary.projectId}{" "}
                    · {setupPlan.projectSummary.dataSource}
                  </Text>
                )}
                {setupPlan.preservesReadme && (
                  <Text size="xs" data-testid="bids-setup-readme-notice">
                    rawdata/README.md is preserved.
                  </Text>
                )}
                {setupPlan.operations.map((operation) => (
                  <Stack
                    gap={2}
                    key={operation.path}
                    data-testid={`bids-setup-operation-${operation.path.replace(/[/.]/g, "-")}`}
                  >
                    <Text size="xs">
                      <strong>{operation.operation}</strong> {operation.path}
                    </Text>
                    {operation.textPreview !== undefined && operation.textPreview !== null && (
                      <Text
                        ff="monospace"
                        size="xs"
                        style={{ whiteSpace: "pre-wrap" }}
                        data-testid={`bids-setup-operation-preview-${operation.path.replace(/[/.]/g, "-")}`}
                      >
                        {operation.textPreview}
                      </Text>
                    )}
                  </Stack>
                ))}
                {setupPlan.warnings.map((warning) => (
                  <Alert key={warning} color="yellow" data-testid="bids-setup-warning">
                    {warning}
                  </Alert>
                ))}
                {setupPlan.conflicts.map((conflict) => (
                  <Alert key={conflict} color="red" data-testid="bids-setup-conflict">
                    {conflict}
                  </Alert>
                ))}
                <Text size="xs" c="dimmed" data-testid="bids-setup-temporary-artifacts">
                  {setupPlan.temporaryArtifacts.join(" ")}
                </Text>
              </Stack>
            )}

            {bidsDialog.kind === "no-subjects" && (
              <Alert color="blue" icon={<IconAlertTriangle size={16} />}>
                No BIDS subjects found in the selected folder. Ensure the folder contains{" "}
                <Text span ff="monospace" size="xs">
                  sub-*
                </Text>{" "}
                directories with ASL data.
              </Alert>
            )}

            {bidsDialog.kind === "no-asl" && (
              <Alert color="blue" icon={<IconAlertTriangle size={16} />}>
                The selected folder contains BIDS subjects but none have valid ASL data. Ensure at
                least one subject has a{" "}
                <Text span ff="monospace" size="xs">
                  perf/
                </Text>{" "}
                directory with{" "}
                <Text span ff="monospace" size="xs">
                  *_asl.json
                </Text>{" "}
                sidecars.
              </Alert>
            )}

            {bidsDialog.kind === "corrupt-desc" && (
              <Alert color="yellow" icon={<IconAlertTriangle size={16} />}>
                The{" "}
                <Text span ff="monospace" size="xs">
                  dataset_description.json
                </Text>{" "}
                file is corrupt, but {bidsDialog.result.aslSubjectCount} ASL subjects were found.
              </Alert>
            )}

            <Group justify="flex-end" gap="sm">
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
                Choose Different Folder
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
                {getConfirmLabel()}
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </div>
  );
}

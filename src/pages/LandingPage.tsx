import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { notifications } from "@mantine/notifications";
import { Button, Divider, Group, Image, Modal, Radio, Stack, Text, Alert } from "@mantine/core";
import { IconAlertTriangle, IconFolderOpen, IconPlus } from "@tabler/icons-react";
import { open } from "@tauri-apps/plugin-dialog";
import { exists } from "@tauri-apps/plugin-fs";
import { homeDir } from "@tauri-apps/api/path";
import { useNavigate, useOutletContext } from "react-router";

import { PROJECT_FILE_NAME } from "../schemas/project";
import { useGlobalStore } from "../stores/globalStore";
import { useProjectStore } from "../stores/projectStore";
import RecentProjectsList from "../components/landing/RecentProjectsList";
import WelcomeCard from "../components/landing/WelcomeCard";
import type { LayoutOutletContext } from "../components/Layout";
import { logAction } from "../lib/debug";
import appLogo from "../../src-tauri/icons/easl_gui_logo.png";

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

export default function LandingPage({ onOpenSettings: onOpenSettingsProp }: LandingPageProps = {}) {
  const navigate = useNavigate();
  const outletContext = useOutletContext<LayoutOutletContext | undefined>();
  const onOpenSettings = onOpenSettingsProp ?? outletContext?.onOpenSettings ?? (() => {});
  const [loading, setLoading] = useState(false);
  const createProject = useProjectStore((state) => state.createProject);
  const loadProject = useProjectStore((state) => state.loadProject);
  const addRecentProject = useGlobalStore((state) => state.addRecentProject);
  const executionProfiles = useGlobalStore((state) => state.settings.executionProfiles);
  const hasValidProfile = useGlobalStore((state) => state.hasValidProfile());
  const recentProjects = useGlobalStore((state) => state.settings.recentProjects);

  const showWelcomeCard = executionProfiles.length === 0;
  const projectActionsDisabled = executionProfiles.length > 0 && !hasValidProfile;

  // BIDS detection dialog state
  const [bidsDialog, setBidsDialog] = useState<BidsDialogState>(null);
  const [bidsRadioValue, setBidsRadioValue] = useState<"bids" | "dicom" | null>(null);
  // Store the selected folder path + project name for dialog actions
  const [pendingFolder, setPendingFolder] = useState<{ path: string; name: string } | null>(null);

  function showError(title: string, message: string) {
    notifications.show({
      color: "red",
      title,
      message,
      autoClose: 10000,
    });
  }

  async function proceedWithProject(
    selected: string,
    projectName: string,
    dataSource: "dicom" | "bids",
  ) {
    const projectPath = `${selected}/${PROJECT_FILE_NAME}`;
    await createProject(selected, projectName, { dataSource });
    addRecentProject(projectPath);
    logAction("landing_new_project_created", { path: selected, name: projectName, dataSource });

    const project = useProjectStore.getState().project;
    if (project) {
      navigate(`/project/${project.projectMeta.id}/import`);
    }
  }

  async function handleNewProject() {
    setLoading(true);
    logAction("landing_new_project_start");

    try {
      let defaultPath: string | undefined;
      if (recentProjects && recentProjects.length > 0) {
        const mostRecent = recentProjects[0];
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

      setPendingFolder({ path: selected, name: projectName });

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
        // Fallback: no BIDS, create DICOM project directly
        await proceedWithProject(selected, projectName, "dicom");
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
    setBidsDialog(null);
    setBidsRadioValue(null);
    setPendingFolder(null);
    logAction("landing_bids_dialog_cancelled");
  }

  async function handleConfirm() {
    if (!bidsRadioValue || !pendingFolder) return;
    const dataSource = bidsRadioValue === "bids" ? "bids" : "dicom";
    logAction("landing_bids_detect_continue", { dataSource });
    const { path, name } = pendingFolder;
    setBidsDialog(null);
    setBidsRadioValue(null);
    setPendingFolder(null);
    setLoading(true);
    try {
      await proceedWithProject(path, name, dataSource);
    } catch {
      showError(
        "Failed to create project",
        "ExploreASL GUI could not initialize the project files in the selected directory.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleNoBidsChooseDifferent() {
    logAction("landing_bids_choose_different");
    setBidsDialog(null);
    setBidsRadioValue(null);
    setPendingFolder(null);
    // Re-trigger the new project flow (reopens folder picker)
    await handleNewProject();
  }

  async function handleOpenProject() {
    setLoading(true);
    logAction("landing_open_project_start");

    try {
      let defaultPath: string | undefined;
      if (recentProjects && recentProjects.length > 0) {
        const mostRecent = recentProjects[0];
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
              onChange={(val) => setBidsRadioValue(val as "bids" | "dicom")}
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
                  Note: A{" "}
                  <Text span ff="monospace" size="xs">
                    rawdata/
                  </Text>{" "}
                  directory will be created in this folder during processing (required for
                  ExploreASL compatibility).
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
                disabled={!bidsRadioValue}
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

import { Button, Group, Modal, Stack, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { invoke } from "@tauri-apps/api/core";
import { platform } from "@tauri-apps/plugin-os";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";
import { useCallback, useEffect, useRef, useState } from "react";

import { useImportStore } from "../stores/importStore";
import { useProcessingStore } from "../stores/processingStore";
import { useProjectStore } from "../stores/projectStore";
import { claimStartupUpdateCheck } from "../lib/updateStartup";

const UPDATE_AVAILABLE_NOTIFICATION_ID = "application-update-available";
const UPDATE_PROGRESS_NOTIFICATION_ID = "application-update-progress";
const UPDATE_ERROR_NOTIFICATION_ID = "application-update-error";
const UPDATE_CHECK_TIMEOUT_MS = 30_000;

interface UpdateManagerProps {
  /** Test-only override. Production callers rely on the build and E2E environment. */
  enabled?: boolean;
}

function checkEnabled(enabled: boolean | undefined) {
  return enabled ?? (import.meta.env.PROD && import.meta.env.VITE_E2E !== "1");
}

function updateErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function showUpdateError(title: string, message: string) {
  notifications.show({
    id: UPDATE_ERROR_NOTIFICATION_ID,
    color: "red",
    title,
    message,
    autoClose: 10_000,
    position: "bottom-right",
  });
}

function activeWork() {
  const processingPhase = useProcessingStore.getState().processingPhase;
  const { importPhase, importRunning } = useImportStore.getState();
  return {
    processing: processingPhase === "preparing" || processingPhase === "running",
    importing: importPhase === "preparing" || importPhase === "running" || importRunning,
  };
}

function progressMessage(downloaded: number, contentLength: number | undefined, finished: boolean) {
  if (finished) return "Installing update…";
  if (!contentLength) return "Downloading update…";
  return `Downloading update… ${Math.min(100, Math.round((downloaded / contentLength) * 100))}%`;
}

export default function UpdateManager({ enabled }: UpdateManagerProps) {
  const [update, setUpdate] = useState<Update | null>(null);
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [preparingUpdate, setPreparingUpdate] = useState(false);
  const updateRef = useRef<Update | null>(null);
  const notificationVisibleRef = useRef(false);
  const updateIntentRef = useRef<"idle" | "confirming" | "preparing" | "installing">("idle");
  const installationStartedRef = useRef(false);
  const preparationStartedRef = useRef(false);

  const releaseAvailableUpdate = useCallback((availableUpdate: Update) => {
    if (
      updateRef.current !== availableUpdate ||
      notificationVisibleRef.current ||
      updateIntentRef.current !== "idle"
    ) {
      return;
    }

    updateRef.current = null;
    void availableUpdate.close().catch(() => undefined);
  }, []);

  const installUpdate = useCallback(async (availableUpdate: Update) => {
    if (installationStartedRef.current) return;
    installationStartedRef.current = true;
    updateIntentRef.current = "installing";
    notifications.hide(UPDATE_AVAILABLE_NOTIFICATION_ID);

    let downloaded = 0;
    let contentLength: number | undefined;
    notifications.show({
      id: UPDATE_PROGRESS_NOTIFICATION_ID,
      loading: true,
      title: `Updating to ${availableUpdate.version}`,
      message: "Preparing update download…",
      autoClose: false,
      position: "bottom-right",
    });

    try {
      await availableUpdate.download((event: DownloadEvent) => {
        if (event.event === "Started") {
          contentLength = event.data.contentLength;
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
        }

        notifications.update({
          id: UPDATE_PROGRESS_NOTIFICATION_ID,
          loading: event.event !== "Finished",
          title: `Updating to ${availableUpdate.version}`,
          message: progressMessage(downloaded, contentLength, event.event === "Finished"),
          autoClose: false,
          position: "bottom-right",
        });
      });

      const { processing, importing } = activeWork();
      if (useProjectStore.getState().isDirty || processing || importing) {
        notifications.hide(UPDATE_PROGRESS_NOTIFICATION_ID);
        showUpdateError(
          "Update not installed",
          "Project changes or active work started while the update downloaded. Finish or save that work, then restart ExploreASL GUI to check again.",
        );
        updateIntentRef.current = "idle";
        installationStartedRef.current = false;
        return;
      }

      notifications.update({
        id: UPDATE_PROGRESS_NOTIFICATION_ID,
        loading: true,
        title: `Updating to ${availableUpdate.version}`,
        message: "Installing update…",
        autoClose: false,
        position: "bottom-right",
      });
      await availableUpdate.install();
    } catch (error) {
      notifications.hide(UPDATE_PROGRESS_NOTIFICATION_ID);
      showUpdateError(
        "Update failed",
        `Version ${availableUpdate.version} could not be downloaded or installed: ${updateErrorMessage(error, "unknown error")}`,
      );
      updateIntentRef.current = "idle";
      installationStartedRef.current = false;
      return;
    } finally {
      if (updateRef.current === availableUpdate) updateRef.current = null;
      void availableUpdate.close().catch(() => undefined);
    }

    try {
      if ((await platform()) === "windows") return;
      await relaunch();
    } catch (error) {
      notifications.hide(UPDATE_PROGRESS_NOTIFICATION_ID);
      showUpdateError(
        "Update installed",
        `Version ${availableUpdate.version} is installed. Restart ExploreASL GUI to finish: ${updateErrorMessage(error, "restart failed")}`,
      );
    }
  }, []);

  const requestUpdate = useCallback(
    (availableUpdate: Update) => {
      if (updateIntentRef.current !== "idle") return;

      const { processing, importing } = activeWork();
      if (useProjectStore.getState().isDirty || processing || importing) {
        updateIntentRef.current = "confirming";
        setUpdate(availableUpdate);
        setConfirmationOpen(true);
        return;
      }

      void installUpdate(availableUpdate);
    },
    [installUpdate],
  );

  const confirmUpdate = useCallback(async () => {
    const availableUpdate = updateRef.current ?? update;
    if (!availableUpdate || preparationStartedRef.current) return;

    preparationStartedRef.current = true;
    updateIntentRef.current = "preparing";
    setPreparingUpdate(true);
    const { processing, importing } = activeWork();
    try {
      if (processing) {
        await useProcessingStore.getState().killProcessing();
      }
      if (importing) {
        await invoke("stop_active_import");
        useImportStore.getState().cancelImport();
      }
      if (useProjectStore.getState().isDirty) {
        await useProjectStore.getState().saveProject();
      }

      const activeAfterPreparation = activeWork();
      if (
        useProjectStore.getState().isDirty ||
        activeAfterPreparation.processing ||
        activeAfterPreparation.importing
      ) {
        throw new Error(
          "Project state changed while preparing the update. No work was interrupted after that change.",
        );
      }
    } catch (error) {
      showUpdateError(
        "Update not started",
        `Could not safely prepare the application for update: ${updateErrorMessage(error, "unknown error")}`,
      );
      updateIntentRef.current = "idle";
      preparationStartedRef.current = false;
      setPreparingUpdate(false);
      releaseAvailableUpdate(availableUpdate);
      return;
    }

    preparationStartedRef.current = false;
    setPreparingUpdate(false);
    setConfirmationOpen(false);
    await installUpdate(availableUpdate);
  }, [installUpdate, releaseAvailableUpdate, update]);

  useEffect(() => {
    let disposed = false;

    queueMicrotask(() => {
      if (disposed || !checkEnabled(enabled) || !claimStartupUpdateCheck()) return;

      void check({ timeout: UPDATE_CHECK_TIMEOUT_MS })
        .then((availableUpdate) => {
          if (!availableUpdate) return;
          if (disposed) {
            void availableUpdate.close().catch(() => undefined);
            return;
          }

          updateRef.current = availableUpdate;
          notificationVisibleRef.current = true;
          setUpdate(availableUpdate);
          notifications.show({
            id: UPDATE_AVAILABLE_NOTIFICATION_ID,
            title: "Update available",
            message: (
              <Group gap="sm" wrap="nowrap" data-testid="update-available-notification">
                <Text size="sm">Version {availableUpdate.version} is available.</Text>
                <Button
                  size="xs"
                  onClick={() => requestUpdate(availableUpdate)}
                  data-testid="update-available-action"
                >
                  Update
                </Button>
              </Group>
            ),
            autoClose: 10_000,
            position: "bottom-right",
            onClose: () => {
              notificationVisibleRef.current = false;
              releaseAvailableUpdate(availableUpdate);
            },
          });
        })
        .catch((error: unknown) => {
          if (!disposed) console.warn("[updater] startup update check failed", error);
        });
    });

    return () => {
      disposed = true;
      notifications.hide(UPDATE_AVAILABLE_NOTIFICATION_ID);
      const availableUpdate = updateRef.current;
      if (availableUpdate && updateIntentRef.current !== "installing") {
        updateRef.current = null;
        void availableUpdate.close().catch(() => undefined);
      }
    };
  }, [enabled, releaseAvailableUpdate, requestUpdate]);

  const processingPhase = useProcessingStore((state) => state.processingPhase);
  const importPhase = useImportStore((state) => state.importPhase);
  const importRunning = useImportStore((state) => state.importRunning);
  const dirty = useProjectStore((state) => state.isDirty);
  const processing = processingPhase === "preparing" || processingPhase === "running";
  const importing = importPhase === "preparing" || importPhase === "running" || importRunning;
  const confirmationAction =
    processing || importing
      ? dirty
        ? "Abort, save, and update"
        : "Abort and update"
      : dirty
        ? "Save and update"
        : "Update";
  const confirmationMessage = [
    processing ? "Processing will be aborted." : "",
    importing ? "Import will be aborted." : "",
    dirty ? "Unsaved project changes will be saved." : "",
    "Continue with the update?",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Modal
      opened={confirmationOpen}
      onClose={() => !preparingUpdate && setConfirmationOpen(false)}
      title="Prepare for update"
      centered
      withCloseButton={false}
      data-testid="update-confirmation-modal"
    >
      <Stack gap="md" data-testid="update-manager">
        <Text>{confirmationMessage}</Text>
        <Group justify="flex-end">
          <Button
            variant="default"
            onClick={() => {
              updateIntentRef.current = "idle";
              setConfirmationOpen(false);
              if (update) releaseAvailableUpdate(update);
            }}
            disabled={preparingUpdate}
            data-testid="update-confirmation-cancel"
          >
            Cancel
          </Button>
          <Button
            color="red"
            onClick={() => void confirmUpdate()}
            loading={preparingUpdate}
            data-testid="update-confirmation-confirm"
          >
            {confirmationAction}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { StrictMode } from "react";
import { notifications } from "@mantine/notifications";
import { invoke } from "@tauri-apps/api/core";
import { platform } from "@tauri-apps/plugin-os";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useImportStore } from "../stores/importStore";
import { useProcessingStore } from "../stores/processingStore";
import { useProjectStore } from "../stores/projectStore";
import { __resetStartupUpdateCheckForTests } from "../lib/updateStartup";
import UpdateManager from "./UpdateManager";

type NotificationCall = Parameters<typeof notifications.show>[0];

function update(version = "0.2.0") {
  return {
    version,
    download: vi.fn(() => Promise.resolve()),
    install: vi.fn(() => Promise.resolve()),
    downloadAndInstall: vi.fn(() => Promise.resolve()),
    close: vi.fn(() => Promise.resolve()),
  };
}

function renderManager() {
  return render(
    <MantineProvider>
      <UpdateManager enabled />
    </MantineProvider>,
  );
}

function availableNotification() {
  const call = vi
    .mocked(notifications.show)
    .mock.calls.find(([value]) => value.id === "application-update-available")?.[0];
  if (!call) throw new Error("Expected update available notification");
  return call as NotificationCall;
}

async function openAvailableUpdate() {
  const call = availableNotification();
  render(<MantineProvider>{call.message}</MantineProvider>);
  await userEvent.setup().click(screen.getByTestId("update-available-action"));
}

describe("UpdateManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetStartupUpdateCheckForTests();
    vi.mocked(check).mockResolvedValue(null);
    vi.mocked(platform).mockResolvedValue("linux");
    useProjectStore.setState({ isDirty: false });
    useProcessingStore.setState({ processingPhase: "idle" });
    useImportStore.setState({ importPhase: "idle", importRunning: false });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("checks exactly once under StrictMode", async () => {
    render(
      <StrictMode>
        <MantineProvider>
          <UpdateManager enabled />
        </MantineProvider>
      </StrictMode>,
    );

    await waitFor(() => expect(check).toHaveBeenCalledOnce());
    expect(check).toHaveBeenCalledWith({ timeout: 30_000 });
  });

  it("uses the explicit production-test override and honors an explicit disable", async () => {
    render(
      <MantineProvider>
        <UpdateManager enabled={false} />
      </MantineProvider>,
    );

    await Promise.resolve();
    expect(check).not.toHaveBeenCalled();
  });

  it("does nothing when no update is available", async () => {
    renderManager();

    await waitFor(() => expect(check).toHaveBeenCalledOnce());
    expect(notifications.show).not.toHaveBeenCalled();
  });

  it("logs update check failures without a user notification", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.mocked(check).mockRejectedValue(new Error("offline"));
    renderManager();

    await waitFor(() =>
      expect(warning).toHaveBeenCalledWith(expect.stringContaining("updater"), expect.any(Error)),
    );
    expect(notifications.show).not.toHaveBeenCalled();
  });

  it("shows a ten-second lower-right notification with the version and Update action", async () => {
    vi.mocked(check).mockResolvedValue(update("1.2.3") as never);
    renderManager();

    await waitFor(() => availableNotification());
    const call = availableNotification();
    expect(call).toMatchObject({
      id: "application-update-available",
      title: "Update available",
      autoClose: 10_000,
      position: "bottom-right",
    });
    render(<MantineProvider>{call.message}</MantineProvider>);
    expect(screen.getByText("Version 1.2.3 is available.")).toBeInTheDocument();
    expect(screen.getByTestId("update-available-action")).toHaveTextContent("Update");
  });

  it("closes an unused update resource when its notification closes", async () => {
    const available = update();
    vi.mocked(check).mockResolvedValue(available as never);
    renderManager();

    await waitFor(() => availableNotification());
    const notification = availableNotification();
    notification.onClose?.(notification);

    await waitFor(() => expect(available.close).toHaveBeenCalledOnce());
  });

  it("installs and relaunches immediately when idle and clean", async () => {
    const available = update();
    vi.mocked(check).mockResolvedValue(available as never);
    renderManager();

    await waitFor(() => availableNotification());
    await openAvailableUpdate();

    await waitFor(() => expect(available.download).toHaveBeenCalledOnce());
    expect(available.install).toHaveBeenCalledOnce();
    expect(notifications.hide).toHaveBeenCalledWith("application-update-available");
    expect(relaunch).toHaveBeenCalledOnce();
  });

  it("saves a dirty project before installing", async () => {
    const available = update();
    const saveProject = vi.fn(async () => {
      useProjectStore.setState({ isDirty: false });
    });
    vi.mocked(check).mockResolvedValue(available as never);
    useProjectStore.setState({ isDirty: true, saveProject });
    renderManager();

    await waitFor(() => availableNotification());
    await openAvailableUpdate();
    expect(screen.getByTestId("update-confirmation-modal")).toBeInTheDocument();
    await userEvent.setup().click(await screen.findByTestId("update-confirmation-confirm"));

    await waitFor(() => expect(saveProject).toHaveBeenCalledOnce());
    await waitFor(() => expect(available.install).toHaveBeenCalledOnce());
    expect(saveProject.mock.invocationCallOrder[0]).toBeLessThan(
      available.install.mock.invocationCallOrder[0],
    );
  });

  it("aborts processing before installing", async () => {
    const available = update();
    const killProcessing = vi.fn(async () => {
      useProcessingStore.setState({ processingPhase: "cancelled" });
    });
    vi.mocked(check).mockResolvedValue(available as never);
    useProcessingStore.setState({ processingPhase: "running", killProcessing });
    renderManager();

    await waitFor(() => availableNotification());
    await openAvailableUpdate();
    await userEvent.setup().click(await screen.findByTestId("update-confirmation-confirm"));

    await waitFor(() => expect(killProcessing).toHaveBeenCalledOnce());
    await waitFor(() => expect(available.install).toHaveBeenCalledOnce());
  });

  it("aborts import through stop_active_import before installing", async () => {
    const available = update();
    vi.mocked(check).mockResolvedValue(available as never);
    useImportStore.setState({ importPhase: "running", importRunning: true });
    renderManager();

    await waitFor(() => availableNotification());
    await openAvailableUpdate();
    await userEvent.setup().click(await screen.findByTestId("update-confirmation-confirm"));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith("stop_active_import"));
    await waitFor(() => expect(available.install).toHaveBeenCalledOnce());
  });

  it("cancels guarded updates without changing work or installing", async () => {
    const available = update();
    vi.mocked(check).mockResolvedValue(available as never);
    useProjectStore.setState({ isDirty: true });
    renderManager();

    await waitFor(() => availableNotification());
    await openAvailableUpdate();
    await userEvent.setup().click(await screen.findByTestId("update-confirmation-cancel"));

    expect(available.download).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.queryByTestId("update-confirmation-cancel")).not.toBeInTheDocument(),
    );
  });

  it("reports installation failure and does not relaunch", async () => {
    const available = update();
    available.download.mockRejectedValue(new Error("network lost"));
    vi.mocked(check).mockResolvedValue(available as never);
    renderManager();

    await waitFor(() => availableNotification());
    await openAvailableUpdate();

    await waitFor(() =>
      expect(notifications.show).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "application-update-error",
          color: "red",
          autoClose: 10_000,
          position: "bottom-right",
        }),
      ),
    );
    expect(relaunch).not.toHaveBeenCalled();
  });

  it("keeps the StrictMode-mounted manager live for guarded updates", async () => {
    const available = update();
    vi.mocked(check).mockResolvedValue(available as never);
    useProjectStore.setState({ isDirty: true });
    render(
      <StrictMode>
        <MantineProvider>
          <UpdateManager enabled />
        </MantineProvider>
      </StrictMode>,
    );

    await waitFor(() => availableNotification());
    await openAvailableUpdate();

    expect(screen.getByTestId("update-confirmation-modal")).toBeInTheDocument();
  });

  it("does not install when saving fails", async () => {
    const available = update();
    const saveProject = vi.fn(() => Promise.reject(new Error("disk full")));
    vi.mocked(check).mockResolvedValue(available as never);
    useProjectStore.setState({ isDirty: true, saveProject });
    renderManager();

    await waitFor(() => availableNotification());
    await openAvailableUpdate();
    await userEvent.setup().click(await screen.findByTestId("update-confirmation-confirm"));

    await waitFor(() => expect(saveProject).toHaveBeenCalledOnce());
    expect(available.download).not.toHaveBeenCalled();
    expect(available.install).not.toHaveBeenCalled();
    expect(relaunch).not.toHaveBeenCalled();
  });

  it("does not install when project work changes during download", async () => {
    const available = update();
    available.download.mockImplementation(async () => {
      useProjectStore.setState({ isDirty: true });
    });
    vi.mocked(check).mockResolvedValue(available as never);
    renderManager();

    await waitFor(() => availableNotification());
    await openAvailableUpdate();

    await waitFor(() => expect(available.download).toHaveBeenCalledOnce());
    expect(available.install).not.toHaveBeenCalled();
    expect(relaunch).not.toHaveBeenCalled();
  });

  it("ignores concurrent Update clicks", async () => {
    const available = update();
    let finishDownload: (() => void) | undefined;
    available.download.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishDownload = resolve;
        }),
    );
    vi.mocked(check).mockResolvedValue(available as never);
    renderManager();

    await waitFor(() => availableNotification());
    const call = availableNotification();
    render(<MantineProvider>{call.message}</MantineProvider>);
    const user = userEvent.setup();
    await user.dblClick(screen.getByTestId("update-available-action"));

    expect(available.download).toHaveBeenCalledOnce();
    finishDownload?.();
    await waitFor(() => expect(available.install).toHaveBeenCalledOnce());
  });
});

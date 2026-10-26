import { Notifications, notifications, notificationsStore } from "@mantine/notifications";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ErrorDetailsModal from "../components/common/ErrorDetailsModal";
import { TestMantineProvider } from "../test/render";
import { showErrorNotification, useErrorDetailsStore } from "./errorNotifications";

vi.unmock("@mantine/notifications");
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: vi.fn() }));

function renderNotifications(page = "First page") {
  return render(
    <TestMantineProvider>
      <Notifications />
      <ErrorDetailsModal />
      <div>{page}</div>
    </TestMantineProvider>,
  );
}

beforeEach(() => {
  notifications.clean();
  useErrorDetailsStore.setState({ error: null });
  vi.mocked(writeText).mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  notifications.clean();
  useErrorDetailsStore.setState({ error: null });
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("error notifications", () => {
  it("upserts the same operation, promotes latest errors, and preserves queued errors", () => {
    for (let index = 0; index < 6; index += 1) {
      showErrorNotification({
        id: `operation-${index}`,
        title: "Failed",
        message: `Failure ${index}`,
      });
    }
    let state = notificationsStore.getState();
    expect(state.notifications).toHaveLength(5);
    expect(state.notifications[0].id).toBe("operation-5");
    expect(state.notifications.every((notification) => notification.autoClose === false)).toBe(
      true,
    );
    expect(state.queue.map((notification) => notification.id)).toEqual(["operation-0"]);

    showErrorNotification({ id: "operation-0", title: "Latest failure", message: "Try again." });
    state = notificationsStore.getState();
    expect(state.notifications).toHaveLength(5);
    expect(state.queue).toHaveLength(1);
    expect(state.notifications[0]).toMatchObject({ id: "operation-0", title: "Latest failure" });
    expect(state.queue[0].id).toBe("operation-1");

    notifications.hide("operation-0");
    expect(notificationsStore.getState().queue).toHaveLength(0);
    expect(notificationsStore.getState().notifications).toHaveLength(5);
    showErrorNotification({ id: "operation-0", title: "Failed again", message: "Try again." });
    expect(notificationsStore.getState().notifications[0].id).toBe("operation-0");
  });

  it("keeps errors until dismissed, without changing ordinary notification lifetime", async () => {
    vi.useFakeTimers();
    renderNotifications();
    act(() => {
      showErrorNotification({ id: "persistent", title: "Failed", message: "Could not save." });
      notifications.show({ id: "success", title: "Saved", message: "Other project saved." });
    });
    expect(screen.getByText("Could not save.")).toBeInTheDocument();

    await act(() => vi.advanceTimersByTimeAsync(60_000));

    expect(screen.getByText("Could not save.")).toBeInTheDocument();
    expect(screen.queryByText("Other project saved.")).not.toBeInTheDocument();
    act(() => notifications.hide("persistent"));
    await act(() => vi.advanceTimersByTimeAsync(1_000));
    expect(screen.queryByText("Could not save.")).not.toBeInTheDocument();
  });

  it.each([undefined, "", "   ", "Could not save."])(
    "omits details link for missing or redundant explanations (%s)",
    (details) => {
      showErrorNotification({
        id: "no-details",
        title: "Failed",
        message: "Could not save.",
        details,
      });
      renderNotifications();
      expect(screen.queryByRole("button", { name: "See details" })).not.toBeInTheDocument();
    },
  );

  it("logs unknown exceptions but never uses their raw message or stack as explanation", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const error = new Error("private internal diagnostic");
    showErrorNotification({
      id: "unknown:/private-study/subject",
      title: "Failed",
      message: "Could not save.",
      error,
    });
    renderNotifications();

    expect(log).toHaveBeenCalledWith("[notification] Failed", error);
    expect(screen.getByText("Could not save.")).toBeInTheDocument();
    expect(screen.queryByText(/private internal diagnostic/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "See details" })).not.toBeInTheDocument();
  });

  it("opens accessible plain-text details, strips terminal escapes, and copies only human content", async () => {
    const user = userEvent.setup();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    showErrorNotification({
      id: "human-details",
      title: "Project not saved",
      message: "Could not save project.",
      error: Object.assign(new Error("developer-only diagnostic"), {
        details:
          "\u001b[91mCheck folder access.\u001b[0m\r\n\r\n<script>literal text</script>\n\u001b]8;;https://example.org\u0007Try again.\u001b]8;;\u0007",
      }),
    });
    const view = renderNotifications();
    await user.click(screen.getByRole("button", { name: "See details" }));

    expect(screen.getByRole("dialog", { name: "Project not saved" })).toBeInTheDocument();
    const explanation = screen.getByTestId("error-details-explanation");
    expect(explanation.textContent).toBe(
      "Check folder access.\n\n<script>literal text</script>\nTry again.",
    );
    expect(explanation.querySelector("script")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Copy details" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument());
    expect(writeText).toHaveBeenCalledWith(
      "Could not save project.\n\nCheck folder access.\n\n<script>literal text</script>\nTry again.",
    );

    view.rerender(
      <TestMantineProvider>
        <Notifications />
        <ErrorDetailsModal />
        <div>Next page</div>
      </TestMantineProvider>,
    );
    expect(screen.getByRole("dialog", { name: "Project not saved" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "See details" })).toBeInTheDocument();
    expect(notificationsStore.getState().notifications).toHaveLength(1);
  });

  it("refreshes an open explanation when the same operation fails again", async () => {
    const user = userEvent.setup();
    showErrorNotification({
      id: "retry",
      title: "Failed",
      message: "Could not save.",
      details: "Check folder access.",
    });
    renderNotifications();
    await user.click(screen.getByRole("button", { name: "See details" }));

    act(() => {
      showErrorNotification({
        id: "retry",
        title: "Failed again",
        message: "Could not save changes.",
        details: "Free disk space, then try again.",
      });
    });

    expect(screen.getByRole("dialog", { name: "Failed again" })).toBeInTheDocument();
    expect(screen.getByTestId("error-details-explanation")).toHaveTextContent(
      "Free disk space, then try again.",
    );
    expect(notificationsStore.getState().notifications).toHaveLength(1);
  });

  it("falls back to browser clipboard and offers manual copying if both methods fail", async () => {
    const user = userEvent.setup();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(writeText).mockRejectedValue(new Error("native clipboard unavailable"));
    const browserCopy = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockRejectedValue(new Error("clipboard denied"));
    showErrorNotification({
      id: "copy",
      title: "Failed",
      message: "Could not save.",
      details: "Try again.",
    });
    renderNotifications();
    await user.click(screen.getByRole("button", { name: "See details" }));
    await user.click(screen.getByRole("button", { name: "Copy details" }));

    expect(await screen.findByTestId("error-details-copy-error")).toHaveTextContent(
      "Select the text and copy it manually.",
    );
    expect(browserCopy).toHaveBeenCalledWith("Could not save.\n\nTry again.");
    expect(screen.getByTestId("error-details-explanation")).toHaveTextContent("Try again.");
  });
});

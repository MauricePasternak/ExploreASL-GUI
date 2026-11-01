import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { exists } from "@tauri-apps/plugin-fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TestMantineProvider } from "../../test/render";
import PathEntryButton from "./PathEntryButton";

afterEach(cleanup);
beforeEach(() => {
  vi.mocked(exists).mockReset().mockResolvedValue(false);
});

function mount(props: Partial<React.ComponentProps<typeof PathEntryButton>> = {}) {
  const onSelect = vi.fn().mockResolvedValue(undefined);
  render(
    <TestMantineProvider>
      <PathEntryButton title="Select file" testId="path" onSelect={onSelect} {...props} />
    </TestMantineProvider>,
  );
  screen.getByTestId("path").focus();
  fireEvent.click(screen.getByTestId("path"));
  return onSelect;
}

function enter(path: string) {
  fireEvent.change(screen.getByTestId("path-input"), { target: { value: path } });
  fireEvent.submit(screen.getByTestId("path-form"));
}

it("rejects relative paths and wrong extensions, preserving spaces in valid paths", async () => {
  const onSelect = mount({ extensions: ["csv"] });
  expect(screen.getByTestId("path-confirm")).toBeDisabled();
  enter("relative.csv");
  expect(screen.getByRole("alert")).toHaveTextContent("absolute filesystem path");
  enter("/study/file.txt");
  expect(screen.getByRole("alert")).toHaveTextContent(".csv");
  expect(onSelect).not.toHaveBeenCalled();
  enter("/study with spaces/file.CSV");
  await waitFor(() =>
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("/study with spaces/file.CSV"),
  );
  expect(exists).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.queryByTestId("path-dialog")).not.toBeInTheDocument());
});

it("cancels without selecting or touching files and restores trigger focus", async () => {
  const onSelect = mount({ defaultPath: "/study/file.csv", save: true });
  screen.getByTestId("path-input").focus();
  fireEvent.click(screen.getByTestId("path-cancel"));
  expect(onSelect).not.toHaveBeenCalled();
  expect(exists).not.toHaveBeenCalled();
  expect(screen.queryByTestId("path-dialog")).not.toBeInTheDocument();
  await waitFor(() => expect(screen.getByTestId("path")).toHaveFocus());
});

it("restores trigger focus after Escape", async () => {
  mount();
  const input = screen.getByTestId("path-input");
  input.focus();
  fireEvent.keyDown(input, { key: "Escape" });
  expect(screen.queryByTestId("path-dialog")).not.toBeInTheDocument();
  await waitFor(() => expect(screen.getByTestId("path")).toHaveFocus());
});

it("requires explicit overwrite approval and resets approval when the path changes", async () => {
  vi.mocked(exists).mockResolvedValue(true);
  const onSelect = mount({ save: true });
  enter("/study/first.md");
  await screen.findByTestId("path-overwrite-warning");
  expect(onSelect).not.toHaveBeenCalled();
  enter("/study/second.md");
  await waitFor(() => expect(exists).toHaveBeenLastCalledWith("/study/second.md"));
  expect(onSelect).not.toHaveBeenCalled();
  fireEvent.click(await screen.findByRole("button", { name: "Replace file" }));
  await waitFor(() => expect(onSelect).toHaveBeenCalledExactlyOnceWith("/study/second.md"));
});

it("reports filesystem failures without calling the writer", async () => {
  vi.mocked(exists).mockRejectedValue(new Error("Permission denied"));
  const onSelect = mount({ save: true });
  enter("/study/file.md");
  expect(await screen.findByRole("alert")).toHaveTextContent("Permission denied");
  expect(onSelect).not.toHaveBeenCalled();
  expect(screen.getByTestId("path-dialog")).toBeInTheDocument();
});

it("keeps write failures visible and blocks duplicate submissions while busy", async () => {
  let fail!: (error: Error) => void;
  const onSelect = vi.fn(
    () =>
      new Promise<void>((_, reject) => {
        fail = reject;
      }),
  );
  mount({ onSelect });
  enter("/study/file.md");
  fireEvent.submit(screen.getByTestId("path-form"));
  expect(onSelect).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId("path-cancel")).toBeDisabled();
  fail(new Error("Disk full"));
  expect(await screen.findByRole("alert")).toHaveTextContent("Disk full");
  expect(screen.getByTestId("path-input")).toHaveValue("/study/file.md");
  expect(screen.getByTestId("path-dialog")).toBeInTheDocument();
});

import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { commands, unwrap } from "./ipc";

beforeEach(() => {
  vi.mocked(invoke).mockReset();
});

describe("generated command boundary", () => {
  it("infers successful results and preserves structured application errors", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(["subject/scan.dcm"]);
    await expect(commands.walkDirectory("source", 20, true)).resolves.toEqual({
      status: "ok",
      data: ["subject/scan.dcm"],
    });
    expect(invoke).toHaveBeenCalledWith("walk_directory", {
      root: "source",
      maxDepth: 20,
      bMatchDirectories: true,
    });
    const error = {
      message: "Source unreadable",
      details: "Permission denied",
      category: "permission_denied",
      kind: "operational",
      issues: [{ field: "source" }],
    };
    vi.mocked(invoke).mockRejectedValueOnce(error);
    const result = await commands.walkDirectory("source", 20, true);
    expect(result).toEqual({ status: "error", error });
    if (result.status === "error") expect(result.error).toBe(error);
  });

  it.each([
    "invalid args `root`",
    { message: "Missing details" },
    { message: "Invalid details", details: 1 },
    { message: 1, details: "Invalid message" },
    Object.create({ message: "Inherited message", details: "Inherited details" }),
    Object.assign(new Date(0), { message: "Non-plain object", details: "Not native JSON" }),
    null,
    42,
  ])(
    "throws framework/malformed rejection instead of inventing a domain result: %j",
    async (error) => {
      vi.mocked(invoke).mockRejectedValueOnce(error);
      await expect(commands.walkDirectory("source", 20, true)).rejects.toMatchObject({
        name: "Error",
        cause: error,
      });
    },
  );

  it("keeps JavaScript errors outside the domain union, even with domain-shaped properties", async () => {
    const error = Object.assign(new Error("IPC disconnected"), { details: "transport" });
    vi.mocked(invoke).mockRejectedValueOnce(error);
    await expect(commands.walkDirectory("source", 20, true)).rejects.toBe(error);
  });

  it("unwraps success and throws readable errors preserving domain fields and cause", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(["scan.dcm"]);
    await expect(unwrap(commands.walkDirectory("source", 20, false))).resolves.toEqual([
      "scan.dcm",
    ]);
    const error = { message: "Disk full", details: "write failed", category: "insufficient_space" };
    vi.mocked(invoke).mockRejectedValueOnce(error);
    const failure = await unwrap(commands.walkDirectory("source", 20, false)).catch(
      (reason: unknown) => reason,
    );
    expect(failure).toBeInstanceOf(Error);
    expect(failure).toMatchObject({ ...error, cause: error });
    expect(String(failure)).toBe("Error: Disk full");
  });

  it("keeps infallible generated commands as plain promises", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(8);
    await expect(commands.getCpuCores()).resolves.toBe(8);
  });
});

// Typechecked, never executed: generated signatures—not caller-selected invoke generics.
function generatedContractChecks() {
  type ApplicationError = Extract<
    Awaited<ReturnType<(typeof commands)[keyof typeof commands]>>,
    { status: "error"; error: unknown }
  >["error"];
  const everyErrorIsStructured: unknown extends ApplicationError
    ? never
    : [ApplicationError] extends [{ message: string; details: string }]
      ? true
      : never = true;
  void everyErrorIsStructured;
  // @ts-expect-error maxDepth is numeric
  commands.walkDirectory("source", "20", true);
}
void generatedContractChecks;

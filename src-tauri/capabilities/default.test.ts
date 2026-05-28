import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("default Tauri capability", () => {
  it("allows project file operations inside user-selected roots", async () => {
    const raw = await readFile(resolve(process.cwd(), "src-tauri/capabilities/default.json"), "utf8");
    const capability = JSON.parse(raw) as {
      permissions: Array<string | { identifier: string; allow?: Array<{ path: string }> }>;
    };

    const fsPermissions = capability.permissions.filter(
      (permission): permission is { identifier: string; allow?: Array<{ path: string }> } =>
        typeof permission === "object" && permission.identifier.startsWith("fs:"),
    );

    expect(fsPermissions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          identifier: "fs:allow-exists",
          allow: expect.arrayContaining([expect.objectContaining({ path: "$HOME/**" })]),
        }),
        expect.objectContaining({
          identifier: "fs:allow-mkdir",
          allow: expect.arrayContaining([expect.objectContaining({ path: "$HOME/**" })]),
        }),
        expect.objectContaining({
          identifier: "fs:allow-read-text-file",
          allow: expect.arrayContaining([expect.objectContaining({ path: "$HOME/**" })]),
        }),
        expect.objectContaining({
          identifier: "fs:allow-write-text-file",
          allow: expect.arrayContaining([expect.objectContaining({ path: "$HOME/**" })]),
        }),
      ]),
    );
  });
});

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("Tauri dev mode ergonomics", () => {
  it("opens devtools and enlarges the main window in debug builds", async () => {
    const raw = await readFile(resolve(process.cwd(), "src-tauri/src/lib.rs"), "utf8");

    expect(raw).toMatch(/cfg\(debug_assertions\)/);
    expect(raw).toMatch(/open_devtools\(\)/);
    expect(raw).toMatch(/set_size\(/);
  });
});

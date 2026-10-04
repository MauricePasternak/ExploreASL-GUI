import { invoke } from "@tauri-apps/api/core";
import { expect, it, vi } from "vitest";

import packageJson from "../../package.json";

it("runs pure tests without browser globals or shared Tauri mocks and inherits Vite defines", () => {
  expect(typeof window).toBe("undefined");
  expect(typeof document).toBe("undefined");
  expect(typeof sessionStorage).toBe("undefined");
  expect(typeof ResizeObserver).toBe("undefined");
  expect(vi.isMockFunction(invoke)).toBe(false);
  expect(import.meta.env.VITE_APP_VERSION).toBe(packageJson.version);
});

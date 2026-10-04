import { afterEach, expect, it, vi } from "vitest";

afterEach(() => vi.resetAllMocks());

it("matches unrestricted columns and reduced motion, including after resetting mocks", () => {
  for (const reset of [false, true]) {
    if (reset) vi.resetAllMocks();

    for (const query of ["", " ", "(prefers-reduced-motion: reduce)", "(min-width: 40em)"]) {
      const media = window.matchMedia(query);
      expect(media.matches).toBe(
        query.trim() === "" || query === "(prefers-reduced-motion: reduce)",
      );
      expect(media.media).toBe(query);
      expect(() => {
        media.addEventListener("change", () => {});
        media.removeEventListener("change", () => {});
      }).not.toThrow();
    }
  }
});

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  activateProjectLease,
  captureProjectLease,
  closeProjectWorkAdmission,
  drainProjectTasks,
  invalidateProjectLease,
  isCurrentProjectLease,
  registerProjectTask,
  resetProjectLifecycleForTests,
  runProjectTransition,
} from "./projectLifecycle";

afterEach(resetProjectLifecycleForTests);

describe("project lifecycle lease", () => {
  it("creates distinct generations for same-ID and same-path activations", () => {
    const first = activateProjectLease("same-id", "/same/path");
    invalidateProjectLease();
    const second = activateProjectLease("same-id", "/same/path");

    expect(second.generation).toBeGreaterThan(first.generation);
    expect(isCurrentProjectLease(first)).toBe(false);
    expect(isCurrentProjectLease(second)).toBe(true);
  });

  it("invalidates a captured lease on close", () => {
    activateProjectLease("project", "/project");
    const lease = captureProjectLease();
    invalidateProjectLease();

    expect(lease).not.toBeNull();
    expect(isCurrentProjectLease(lease)).toBe(false);
    expect(captureProjectLease()).toBeNull();
  });

  it("rejects new work after transition admission closes", () => {
    activateProjectLease("project", "/project");
    closeProjectWorkAdmission();

    expect(() => registerProjectTask(Promise.resolve())).toThrow(/transition/i);
  });

  it("never invokes an admitted thunk after active-project admission closes", () => {
    activateProjectLease("project", "/project");
    closeProjectWorkAdmission();
    const thunk = vi.fn(async () => undefined);

    expect(() => registerProjectTask(thunk)).toThrow(/transition/i);
    expect(thunk).not.toHaveBeenCalled();
  });

  it("waits for registered work to settle", async () => {
    activateProjectLease("project", "/project");
    let release!: () => void;
    const task = new Promise<void>((resolve) => {
      release = resolve;
    });
    registerProjectTask(task);
    let drained = false;
    const drain = drainProjectTasks().then(() => {
      drained = true;
    });

    await Promise.resolve();
    expect(drained).toBe(false);
    release();
    await drain;
    expect(drained).toBe(true);
  });

  it("serializes project transitions", async () => {
    const order: string[] = [];
    let release!: () => void;
    const first = runProjectTransition(async () => {
      order.push("first-start");
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      order.push("first-end");
    });
    const second = runProjectTransition(async () => {
      order.push("second");
    });

    await Promise.resolve();
    expect(order).toEqual(["first-start"]);
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(["first-start", "first-end", "second"]);
  });
});

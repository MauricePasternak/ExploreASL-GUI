export interface ProjectLease {
  generation: number;
  projectId: string;
  rootPath: string;
}

let generation = 0;
let activeLease: ProjectLease | null = null;
let acceptingWork = false;
let transitionTail: Promise<void> = Promise.resolve();
const projectTasks = new Set<Promise<unknown>>();

export function activateProjectLease(projectId: string, rootPath: string): ProjectLease {
  generation += 1;
  activeLease = Object.freeze({ generation, projectId, rootPath });
  acceptingWork = true;
  return activeLease;
}

export function captureProjectLease(): ProjectLease | null {
  return activeLease;
}

export function isCurrentProjectLease(lease: ProjectLease | null | undefined): boolean {
  return Boolean(
    lease &&
    activeLease &&
    lease.generation === activeLease.generation &&
    lease.projectId === activeLease.projectId &&
    lease.rootPath === activeLease.rootPath,
  );
}

export function invalidateProjectLease(): void {
  generation += 1;
  activeLease = null;
  acceptingWork = false;
}

export function closeProjectWorkAdmission(): void {
  acceptingWork = false;
}

export function isProjectWorkAccepted(): boolean {
  return acceptingWork && activeLease !== null;
}

export function reopenProjectWorkAdmission(): void {
  if (activeLease) acceptingWork = true;
}

export function registerProjectTask<T>(task: Promise<T> | (() => Promise<T>)): Promise<T> {
  if (activeLease && !acceptingWork) {
    // Thunks are preferred: admission is decided before any reservation or
    // mutation starts. Promise arguments may already be running and therefore
    // cannot receive the same start barrier.
    if (typeof task !== "function") void task.catch(() => undefined);
    throw new Error("Project transition is in progress; new project work is not accepted.");
  }
  if (!activeLease) {
    // Store actions may still perform local validation in unit/test contexts
    // without a hydrated project. Production processing uses the admitted
    // thunk path below once a project lease exists.
    if (typeof task === "function") return Promise.resolve().then(task);
    void task.catch(() => undefined);
    throw new Error("Project transition is in progress; new project work is not accepted.");
  }
  // A thunk is admitted before it begins. Long preparation flows use this form
  // so a transition cannot close admission between task creation and native
  // reservation.
  const tracked = Promise.resolve().then(() => (typeof task === "function" ? task() : task));
  projectTasks.add(tracked);
  void tracked.then(
    () => projectTasks.delete(tracked),
    () => projectTasks.delete(tracked),
  );
  return tracked;
}

export async function drainProjectTasks(): Promise<void> {
  while (projectTasks.size > 0) {
    await Promise.allSettled([...projectTasks]);
  }
}

export function runProjectTransition<T>(operation: () => Promise<T>): Promise<T> {
  const result = transitionTail.then(operation, operation);
  transitionTail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export function resetProjectLifecycleForTests(): void {
  generation = 0;
  activeLease = null;
  acceptingWork = false;
  projectTasks.clear();
  transitionTail = Promise.resolve();
}

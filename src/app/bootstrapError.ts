export function renderBootstrapError(root: HTMLElement, error: unknown): void {
  console.error("[bootstrap] Application startup failed:", error);

  const alert = document.createElement("div");
  alert.setAttribute("role", "alert");
  alert.textContent = error instanceof Error ? error.message : String(error);
  root.replaceChildren("ExploreASL GUI could not start.", alert);
}

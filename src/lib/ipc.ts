export { commands } from "../generated/bindings";

/** Preserve throw-based flows without losing generated argument/result inference. */
export async function unwrap<T, E extends { message: string; details: string }>(
  result: Promise<{ status: "ok"; data: T } | { status: "error"; error: E }>,
): Promise<T> {
  const response = await result;
  if (response.status === "ok") return response.data;
  throw Object.assign(new Error(response.error.message), response.error, {
    cause: response.error,
  });
}

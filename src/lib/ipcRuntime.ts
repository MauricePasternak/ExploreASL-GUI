// Embedded into generated bindings by tauri-specta; not imported as a module.
// oxlint-disable-next-line no-unused-vars
async function typedError<T, E>(
  result: Promise<T>,
): Promise<{ status: "ok"; data: T } | { status: "error"; error: E }> {
  try {
    return { status: "ok", data: await result };
  } catch (error) {
    if (error instanceof Error) throw error;
    if (
      typeof error === "object" &&
      error !== null &&
      Object.getPrototypeOf(error) === Object.prototype &&
      "message" in error &&
      typeof error.message === "string" &&
      "details" in error &&
      typeof error.details === "string"
    ) {
      return { status: "error", error: error as E };
    }
    const message =
      typeof error === "string"
        ? error
        : typeof error === "object" &&
            error !== null &&
            "message" in error &&
            typeof error.message === "string"
          ? error.message
          : "Native command failed with an invalid error response";
    throw Object.assign(new Error(message), { cause: error });
  }
}

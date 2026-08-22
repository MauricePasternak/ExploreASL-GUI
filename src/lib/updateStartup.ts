let startupCheckStarted = false;

export function claimStartupUpdateCheck() {
  if (startupCheckStarted) return false;
  startupCheckStarted = true;
  return true;
}

/** @internal Test isolation hook for the process-lifetime startup guard. */
export function __resetStartupUpdateCheckForTests() {
  startupCheckStarted = false;
}

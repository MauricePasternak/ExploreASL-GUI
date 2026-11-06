import { config as nativeConfig } from "./wdio.conf";
import { ANALYSIS_TIMEOUT } from "./test/support/full-analysis-fixture";

if (!process.env.E2E_ANALYSIS_PROJECT) {
  throw new Error(
    "Use pnpm test:e2e:full-analysis; isolated setup must run before the app starts.",
  );
}

export const config = {
  ...nativeConfig,
  specs: ["./test/full-analysis/full-analysis.e2e.ts"],
  mochaOpts: { ...nativeConfig.mochaOpts, timeout: ANALYSIS_TIMEOUT + 5 * 60_000 },
};

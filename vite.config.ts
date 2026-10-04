/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { readFileSync } from "fs";
import { defineConfig } from "vite";

const packageJson = JSON.parse(readFileSync("./package.json", "utf-8"));

// These tests exercise schemas and helpers without browser APIs or shared IPC mocks.
const nodeTests = [
  "src/schemas/**/*.test.ts",
  "src/lib/bids/{errorFormatter,normalize,setup,sidecar,subjectRows}.test.ts",
  "src/lib/aslRun.test.ts",
  "src/lib/assembleDataPar.test.ts",
  "src/lib/commaNumbers.test.ts",
  "src/lib/dataParDefaults.test.ts",
  "src/lib/dataParFieldMetadata.test.ts",
  "src/lib/dataParFlags.test.ts",
  "src/lib/dicomRelink.test.ts",
  "src/lib/importPlan.test.ts",
  "src/lib/importPreviewUtils.test.ts",
  "src/lib/importStaleness.test.ts",
  "src/lib/importStepAccess.test.ts",
  "src/lib/interRaterAgreement.test.ts",
  "src/lib/logViewer.test.ts",
  "src/lib/manifestCsvExport.test.ts",
  "src/lib/manifestExport.test.ts",
  "src/lib/manifestMethods.test.ts",
  "src/lib/nivoTheme.test.ts",
  "src/lib/pathUtils.test.ts",
  "src/lib/projectIdentity.test.ts",
  "src/lib/projectPaths.test.ts",
  "src/lib/qcLabels.test.ts",
  "src/lib/snapshotCompression.test.ts",
  "src/lib/stagingValidation.test.ts",
  "src/lib/subjectMatching.test.ts",
  "src/lib/tokenizerUtils.test.ts",
  "src/lib/tsvUtils.test.ts",
  "src/components/import/metadata{FieldHints,FormUtils}.test.ts",
  "src/components/processing/{ExecutionDashboard,SubjectSelection,subjectStatusIndex}.test.ts",
  "scripts/check-e2e-bundle.test.ts",
  "src-tauri/{dev-mode,capabilities/default}.test.ts",
  "src/test/nodeEnvironment.test.ts",
];
const testExclude = ["**/node_modules/**", "**/.worktrees/**", "e2e-tests/**"];

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],
  define: {
    "import.meta.env.VITE_APP_VERSION": JSON.stringify(packageJson.version),
  },
  build: {
    chunkSizeWarningLimit: 3000,
    rolldownOptions: {
      checks: {
        largeBarrelModules: false,
      },
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },

  // Vitest configuration
  test: {
    exclude: testExclude,
    pool: "forks",
    testTimeout: 30000,
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          include: nodeTests,
        },
      },
      {
        extends: true,
        test: {
          name: "dom",
          environment: "jsdom",
          setupFiles: ["./src/test/setup.tsx"],
          exclude: [...testExclude, ...nodeTests],
        },
      },
    ],
  },
}));

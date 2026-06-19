import os from "os";
import path from "path";
import { spawn, spawnSync } from "child_process";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

let tauriDriver;
let exit = false;

export const config = {
  host: "127.0.0.1",
  port: 4444,
  specs: ["./test/specs/**/*.ts"],
  maxInstances: 1,
  capabilities: [
    {
      maxInstances: 1,
      "tauri:options": {
        application: path.resolve(__dirname, "../src-tauri/target/debug/exploreasl_gui"),
      },
    },
  ],
  reporters: ["spec"],
  framework: "mocha",
  mochaOpts: {
    ui: "bdd",
    timeout: 60000,
  },

  onPrepare: () => {
    spawnSync("pnpm", ["tauri", "build", "--", "--debug", "--no-bundle"], {
      cwd: path.resolve(__dirname, ".."),
      stdio: "inherit",
      shell: true,
    });
  },

  beforeSession: () => {
    tauriDriver = spawn(path.resolve(os.homedir(), ".cargo", "bin", "tauri-driver"), [], {
      stdio: [null, process.stdout, process.stderr],
    });

    tauriDriver.on("error", (error) => {
      console.error("tauri-driver error:", error);
      process.exit(1);
    });

    tauriDriver.on("exit", (code) => {
      if (!exit) {
        console.error("tauri-driver exited with code:", code);
        process.exit(1);
      }
    });
  },

  afterSession: () => {
    closeTauriDriver();
  },
};

function closeTauriDriver() {
  exit = true;
  tauriDriver?.kill();
}

function onShutdown(fn: () => void) {
  const cleanup = () => {
    try {
      fn();
    } finally {
      process.exit();
    }
  };

  process.on("exit", cleanup);
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
  process.on("SIGHUP", cleanup);
  process.on("SIGBREAK", cleanup);
}

onShutdown(() => {
  closeTauriDriver();
});

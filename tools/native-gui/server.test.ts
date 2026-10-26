import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "./server";
import { copyProject, NativeGuiSession, sandboxArguments, seedProfiles } from "./session";

test("MCP advertises native controls, validates inputs and reports missing launch", async () => {
  const { server, shutdown } = createServer();
  const client = new Client({ name: "native-gui-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const tools = (await client.listTools()).tools;
    assert.deepEqual(
      tools.map((tool) => tool.name),
      [
        "launch",
        "close",
        "inspect",
        "screenshot",
        "click",
        "fill",
        "select",
        "keys",
        "wait",
        "navigate",
        "copy_project",
      ],
    );
    const launchSchema = tools.find((tool) => tool.name === "launch")!.inputSchema;
    assert.partialDeepStrictEqual(launchSchema.properties?.fresh, { type: "boolean" });
    assert.partialDeepStrictEqual(launchSchema.properties?.profile_template, { type: "string" });
    assert.partialDeepStrictEqual(launchSchema.properties?.display, {
      type: "string",
      enum: ["virtual", "desktop"],
    });
    assert.ok(!launchSchema.required?.length);
    for (const args of [{ fresh: "yes" }, { profile_template: " " }, { display: "wayland" }]) {
      const invalidLaunch = await client.callTool({ name: "launch", arguments: args });
      assert.equal(invalidLaunch.isError, true);
    }
    const missingLaunch = await client.callTool({ name: "inspect", arguments: {} });
    assert.equal(missingLaunch.isError, true);
    assert.match(JSON.stringify(missingLaunch.content), /Launch the native GUI first/);
    const invalid = await client.callTool({
      name: "wait",
      arguments: { selector: "body", timeout_ms: -1 },
    });
    assert.equal(invalid.isError, true);
    const invalidRoute = await client.callTool({
      name: "navigate",
      arguments: { route: "https://example.com" },
    });
    assert.equal(invalidRoute.isError, true);
    const closed = await client.callTool({ name: "close", arguments: {} });
    assert.notEqual(closed.isError, true); // A failed call must not poison this session's queue.
  } finally {
    await shutdown();
    await client.close();
    await server.close();
  }
});

test(
  "desktop mode rejects missing or stale graphical credentials before starting processes",
  { skip: process.platform !== "linux" },
  async () => {
    const previousDisplay = process.env.DISPLAY;
    const previousAuthority = process.env.XAUTHORITY;
    const gui = new NativeGuiSession();
    delete process.env.DISPLAY;
    try {
      await assert.rejects(gui.launch({ display: "desktop" }), /Desktop mode requires DISPLAY/);
      process.env.DISPLAY = ":65534";
      process.env.XAUTHORITY = "/nonexistent-native-gui-test/Xauthority";
      await assert.rejects(gui.launch({ display: "desktop" }), /Desktop Xauthority unavailable/);
    } finally {
      if (previousDisplay === undefined) delete process.env.DISPLAY;
      else process.env.DISPLAY = previousDisplay;
      if (previousAuthority === undefined) delete process.env.XAUTHORITY;
      else process.env.XAUTHORITY = previousAuthority;
      await gui.stopDriver();
    }
  },
);

test("profile templates import only schema-valid profiles without changing source or existing settings", async () => {
  const base = path.join(tmpdir(), "opencode");
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, "native-gui-profiles-test-"));
  try {
    const source = path.join(root, "template.json");
    const workspace = path.join(root, "workspace");
    const settings = path.join(
      workspace,
      "data",
      "com.mpasternak.exploreasl-gui-v0",
      "settings.json",
    );
    const matlab = {
      id: "550e8400-e29b-41d4-a716-446655440000",
      type: "matlab",
      label: "Saved MATLAB",
      matlabPath: "/opt/matlab/bin/matlab",
      exploreAslPath: "/opt/ExploreASL",
    };
    const apptainer = {
      id: "550e8400-e29b-41d4-a716-446655440001",
      type: "apptainer",
      label: "Saved Apptainer",
      sifPath: "/opt/exploreasl.sif",
    };
    const original = JSON.stringify({
      executionProfiles: [{ ...matlab, secret: "not imported" }, apptainer],
      theme: "dark",
      recentProjects: [{ path: "/personal/project.easl" }],
      profileValidationState: { [matlab.id]: { valid: true, errors: [] } },
    });
    await writeFile(source, original);
    await seedProfiles(source, workspace);
    assert.deepEqual(JSON.parse(await readFile(settings, "utf8")), {
      executionProfiles: [matlab, { ...apptainer, apptainerPath: "apptainer" }],
    });
    assert.equal(await readFile(source, "utf8"), original);
    await assert.rejects(seedProfiles(source, workspace), { code: "EEXIST" });

    for (const invalid of [
      "not JSON",
      "null",
      "{}",
      JSON.stringify({ executionProfiles: [] }),
      JSON.stringify({ executionProfiles: [{ ...matlab, type: "docker" }] }),
      JSON.stringify({ executionProfiles: [{ ...matlab, id: "not-a-uuid" }] }),
      JSON.stringify({ executionProfiles: [{ ...matlab, matlabPath: "" }] }),
    ]) {
      await writeFile(source, invalid);
      await assert.rejects(seedProfiles(source, path.join(root, "invalid")));
    }
    await assert.rejects(seedProfiles(path.join(root, "missing.json"), workspace), {
      code: "ENOENT",
    });
    assert.deepEqual(JSON.parse(await readFile(settings, "utf8")), {
      executionProfiles: [matlab, { ...apptainer, apptainerPath: "apptainer" }],
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("element helper rejects ambiguous selectors and centers controls before interaction", async () => {
  const gui = new NativeGuiSession();
  let count = 1;
  const calls: unknown[] = [];
  const element = {
    waitForDisplayed: async () => {
      calls.push("visible");
    },
    scrollIntoView: async (options: unknown) => {
      calls.push(options);
    },
  };
  Object.defineProperty(gui, "browser", {
    value: {
      execute: async () => count,
      $: () => element,
    },
  });
  assert.equal(await gui.element("#target"), element);
  assert.deepEqual(calls, ["visible", { block: "center", inline: "center" }]);
  count = 2;
  await assert.rejects(gui.element("button"), /matched 2 elements/);
});

test("project copies preserve originals and symlinks; reject recursive workspace copies", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "native-gui-test-"));
  try {
    const source = path.join(root, "source");
    const workspace = path.join(root, "workspace");
    await Promise.all([mkdir(source), mkdir(workspace)]);
    await writeFile(path.join(source, "project.easl"), "original");
    await writeFile(path.join(root, "external.txt"), "external");
    await symlink(path.join(root, "external.txt"), path.join(source, "external.txt"));
    const copied = await copyProject(source, workspace);
    await writeFile(copied, "edited");
    assert.equal(await readFile(path.join(source, "project.easl"), "utf8"), "original");
    assert.equal(
      await readlink(path.join(path.dirname(copied), "external.txt")),
      path.join(root, "external.txt"),
    );
    await assert.rejects(copyProject(root, workspace), /recursive self-copy/);
    await assert.rejects(copyProject(path.join(root, "missing"), workspace));
    const args = sandboxArguments(workspace);
    assert.deepEqual(args.slice(1, 6), ["--unshare-pid", "--ro-bind", "/", "/", "--dev"]);
    assert.ok(args.includes("--die-with-parent"));
    assert.ok(args.includes(path.join(workspace, "config")));
    const tempVariable = args.indexOf("TMPDIR");
    assert.equal(args[tempVariable + 1], workspace); // Must fit Tauri's $TEMP filesystem scope.
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test(
  "Linux sandbox confines writes and exposes desktop authority read-only across private temporary mounts",
  { skip: process.platform !== "linux" },
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), "native-gui-sandbox-test-"));
    try {
      const source = path.join(root, "source");
      const workspace = path.join(root, "workspace");
      await Promise.all([mkdir(source), mkdir(workspace)]);
      await mkdir(path.join(workspace, "runtime"));
      const authority = path.join(root, "Xauthority");
      await writeFile(authority, "desktop-cookie", { mode: 0o600 });
      const original = path.join(source, "original.txt");
      await writeFile(original, "unchanged");
      await symlink(original, path.join(workspace, "external-link"));
      const result = spawnSync(
        "bwrap",
        [
          ...sandboxArguments(workspace, authority),
          "--ro-bind",
          source,
          source,
          "--",
          process.execPath,
          "--input-type=module",
          "-e",
          `import assert from 'node:assert/strict'; import {readFileSync, writeFileSync} from 'node:fs';
       assert.ok(readFileSync(process.env.XAUTHORITY, 'utf8') === 'desktop-cookie');
       assert.throws(() => writeFileSync(process.env.XAUTHORITY, 'bad'), {code: 'EROFS'});
       for (const file of process.argv.slice(1, 3)) assert.throws(() => writeFileSync(file, 'bad'), {code: 'EROFS'});
       writeFileSync(process.argv[3], 'allowed');`,
          original,
          path.join(workspace, "external-link"),
          path.join(workspace, "output.txt"),
        ],
        { encoding: "utf8", timeout: 10_000, env: { ...process.env, XAUTHORITY: authority } },
      );
      assert.equal(result.status, 0, result.error?.message ?? result.stderr);
      assert.equal(await readFile(original, "utf8"), "unchanged");
      assert.equal(await readFile(authority, "utf8"), "desktop-cookie");
      assert.equal(await readFile(path.join(workspace, "output.txt"), "utf8"), "allowed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

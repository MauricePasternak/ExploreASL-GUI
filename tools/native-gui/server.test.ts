import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, open, readFile, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createServer as createHttpServer } from "node:http";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "./server";
import {
  copyProject,
  inspectDom,
  NativeGuiSession,
  observeState,
  pageScript,
  sandboxArguments,
  seedProfiles,
  SizeSchema,
  viewportMetrics,
} from "./session";
import { LOG_BYTES, LOG_LINES, pngDimensions, saveArtifact, tailLog } from "./diagnostics";

test("MCP advertises native controls, validates inputs and reports missing launch", async (context) => {
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
        "resize",
        "diagnostics",
        "close",
        "inspect",
        "screenshot",
        "click",
        "hover",
        "scroll",
        "drag",
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
    for (const args of [
      { fresh: "yes" },
      { profile_template: " " },
      { display: "wayland" },
      { window_size: { width: 0, height: 800 } },
      { screen_size: { width: 3840, height: 4097 } },
    ]) {
      const invalidLaunch = await client.callTool({ name: "launch", arguments: args });
      assert.equal(invalidLaunch.isError, true);
    }
    const missingLaunch = await client.callTool({ name: "inspect", arguments: {} });
    assert.equal(missingLaunch.isError, true);
    assert.match(JSON.stringify(missingLaunch.content), /Launch the native GUI first/);
    const empty = await client.callTool({ name: "diagnostics", arguments: {} });
    assert.match(JSON.stringify(empty.content), /No connected native browser/);
    for (const args of [
      { styles: Array(13).fill("color") },
      { styles: ["color;display"] },
      { include_hidden: "yes" },
      { limit: 501 },
    ]) {
      assert.equal((await client.callTool({ name: "inspect", arguments: args })).isError, true);
    }
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
    const handlers = (["click", "hover", "scroll", "drag"] as const).map((name) =>
      context.mock.method(NativeGuiSession.prototype, name, async () => {
        throw new Error("Action handler reached before validation");
      }),
    );
    for (const [name, args] of [
      ["click", { point: { x: -1, y: 0 } }],
      ["hover", { point: { x: 0, y: 4096 } }],
      ["scroll", { delta_y: 10001 }],
      ["drag", { from: { x: 0, y: 0 }, to: { x: -1, y: 1 } }],
    ] as const) {
      const result = await client.callTool({ name, arguments: { selector: "body", ...args } });
      assert.equal(result.isError, true);
      assert.match(JSON.stringify(result.content), /Input validation error/);
    }
    for (const handler of handlers) assert.equal(handler.mock.calls.length, 0);
    const closed = await client.callTool({ name: "close", arguments: {} });
    assert.notEqual(closed.isError, true); // A failed call must not poison this session's queue.
  } finally {
    await shutdown();
    await client.close();
    await server.close();
  }
});

test("size bounds and capacity checks reject before native input; metrics distinguish CSS/image units", async () => {
  for (const width of [0, -1, 1.5, 4097, Infinity])
    assert.equal(SizeSchema.safeParse({ width, height: 900 }).success, false);
  assert.deepEqual(SizeSchema.parse({ width: 2160, height: 3840 }), { width: 2160, height: 3840 });
  const gui = new NativeGuiSession();
  await assert.rejects(
    gui.launch({ display: "desktop", screen_size: { width: 100, height: 100 } }),
    /virtual-only/,
  );
  await assert.rejects(
    gui.launch({ window_size: { width: 800, height: 1200 } }),
    /exceeds screen_size/,
  );
  let resized = false;
  Object.defineProperty(gui, "browser", {
    value: {
      setWindowSize: async () => {
        resized = true;
      },
    },
  });
  Object.defineProperty(gui, "screenSize", { value: { width: 1920, height: 1080 } });
  await assert.rejects(gui.resize({ width: 2000, height: 1000 }), /Explicitly close\/relaunch/);
  assert.equal(resized, false);
  const metrics = vm.runInNewContext(`(${viewportMetrics.toString()})()`, {
    location: { href: "tauri://localhost/#/overview", hash: "#/overview" },
    innerWidth: 800,
    innerHeight: 600,
    devicePixelRatio: 2,
    screen: { width: 1920, height: 1080, availWidth: 1920, availHeight: 1080 },
    window: { visualViewport: null },
  });
  assert.equal(metrics.viewport.width, 800);
  assert.equal(metrics.viewport.units, "CSS pixels");
  assert.equal(metrics.device_pixel_ratio, 2);
  assert.equal(metrics.screen.width, 1920);
});

test("inspection and targeted failure evidence stay read-only, bounded, unique and password-redacted", async (testContext) => {
  class Element {
    tagName = "BUTTON";
    parentElement = null;
    id = "";
    labels = [];
    disabled = false;
    checked = false;
    type = "text";
    value: string | number = "value";
    innerText = "button";
    visibility = "visible";
    opacity = "1";
    scrollLeft = 2;
    scrollTop = 3;
    scrollWidth = 900;
    scrollHeight = 1200;
    clientWidth = 100;
    clientHeight = 40;
    constructor(
      readonly name: string,
      readonly x = 10,
      readonly layout = true,
    ) {}
    getAttribute(key: string) {
      return key === "data-testid" ? this.name : null;
    }
    getClientRects() {
      return this.layout ? [this.getBoundingClientRect()] : [];
    }
    getBoundingClientRect() {
      return {
        x: this.x,
        y: 20,
        left: this.x,
        top: 20,
        right: this.x + 100,
        bottom: 60,
        width: this.layout ? 100 : 0,
        height: this.layout ? 40 : 0,
      };
    }
    contains(node: Element) {
      return node === this;
    }
    querySelectorAll() {
      return controls;
    }
    querySelector() {
      return this === root ? controls[0] : null;
    }
  }
  const root = new Element("root");
  const password = new Element("password");
  password.type = "password";
  password.value = "never reveal this";
  const hidden = new Element("hidden", 10, false);
  const offscreen = new Element("offscreen", 1000);
  const covered = new Element("covered", 300);
  const listItem = new Element("processing-status-item");
  listItem.tagName = "LI";
  listItem.value = 0; // HTMLLIElement.value is numeric, unlike an input's value.
  const controls = [password, hidden, offscreen, covered, listItem];
  let roots = [root];
  const document = {
    querySelectorAll: (selector: string) =>
      selector === "body"
        ? roots
        : [root, ...controls].filter(
            (node) => selector === `[data-testid=${JSON.stringify(node.name)}]`,
          ),
    activeElement: password,
    elementFromPoint: (x: number) => (x > 300 ? root : password),
  };
  const context = {
    document,
    HTMLElement: Element,
    window: { location: { href: "tauri://localhost" } },
    getComputedStyle: (node: Element) => ({
      visibility: node.visibility,
      opacity: node.opacity,
      getPropertyValue: () => "red".repeat(200),
    }),
    innerWidth: 800,
    innerHeight: 600,
    scrollX: 0,
    scrollY: 10,
  };
  const inspect = (includeHidden: boolean, limit = 20, geometry = true) =>
    vm.runInNewContext(`(function () { ${pageScript(inspectDom)} }).apply(null, args)`, {
      ...context,
      args: ["body", { limit, styles: ["color"], includeHidden, geometry }],
    }) as ReturnType<typeof inspectDom>;
  const result = inspect(true);
  assert.equal(result.total, 6);
  assert.ok(!JSON.stringify(result).includes(password.value));
  assert.equal(result.elements[1].value, "[redacted]");
  assert.equal(result.elements[1].focused, true);
  assert.equal(result.elements[1].center_hit!.status, "uncovered");
  assert.equal(result.elements[2].center_hit!.status, "hidden");
  assert.equal(result.elements[3].center_hit!.status, "outside-viewport");
  assert.equal(result.elements[3].visible, true);
  assert.equal(result.elements[4].center_hit!.status, "covered");
  assert.equal(result.elements[4].inViewport, true);
  assert.equal(result.elements[4].bounds!.width, 100);
  assert.equal(result.elements[4].styles!.color.length, 500);
  assert.equal(result.elements[4].scroll!.top, 3);
  assert.equal(result.elements[5].value, 0);
  assert.equal(inspect(false).total, 5);
  assert.equal(inspect(true, 2).elements.length, 2);
  const compact = inspect(true, 20, false);
  assert.equal(compact.hit_test_note, undefined);
  assert.ok(compact.elements.every((element) => !element.bounds && !element.center_hit));
  assert.equal(compact.elements[0].text, undefined); // Root text is already top-level text.
  assert.equal(compact.elements[1].value, "[redacted]");
  assert.equal(compact.elements[1].focused, true);
  assert.equal(compact.elements[1].hidden, undefined);
  assert.equal(compact.elements[2].hidden, true);
  assert.equal(compact.elements[3].offscreen, true);
  assert.equal(compact.elements[4].disabled, undefined);
  assert.equal(compact.elements[4].text, "button");
  roots = [root, root];
  assert.throws(
    () => inspect(true),
    /ambiguous: matched 2 elements; narrow the CSS selector\. First matches: \[data-testid="root"\] "button"; /,
  );
  roots = [];
  assert.throws(
    () => inspect(true),
    /Target absent: body\. Current URL: tauri:\/\/localhost\. inspect does not wait/,
  );
  roots = [root];

  const base = path.join(tmpdir(), "opencode");
  await mkdir(base, { recursive: true });
  const gui = new NativeGuiSession();
  gui.workspace = await mkdtemp(path.join(base, "native-gui-target-test-"));
  try {
    const diagnostics = await gui.diagnostics();
    testContext.mock.method(gui, "diagnostics", async () => diagnostics);
    const png = Buffer.alloc(24);
    Buffer.from("89504e470d0a1a0a", "hex").copy(png);
    png.write("IHDR", 12);
    Object.defineProperties(gui, {
      connection: { value: {} },
      probe: {
        value: async (command: string, body?: { script: string; args: unknown[] }) => {
          if (command === "screenshot") return png.toString("base64");
          assert.equal(command, "execute/sync");
          return vm.runInNewContext(`(function () { ${body!.script} }).apply(null, args)`, {
            ...context,
            args: body!.args,
          });
        },
      },
    });
    const evidence = await gui.failureEvidence('[data-testid="hidden"]');
    assert.deepEqual(evidence.errors, []);
    assert.equal(evidence.artifacts.length, 3);
    assert.ok(evidence.target?.inspection);
    const target = evidence.target.inspection;
    assert.equal(target.elements.length, 1);
    assert.equal(target.elements[0].selector, '[data-testid="hidden"]');
    assert.equal(target.elements[0].visible, false);
    assert.equal(target.elements[0].center_hit!.status, "hidden");
    assert.ok("pointer-events" in target.elements[0].styles!);
    const body = JSON.parse(
      await readFile(
        evidence.artifacts.find((file) => file.endsWith(".dom.json"))!,
        "utf8",
      ),
    );
    assert.ok(
      !body.elements.some((element: { selector: string }) => element.selector.includes("hidden")),
    );
    assert.ok(!JSON.stringify(body).includes(password.value));
    const late = new Element("late-target", 300);
    late.disabled = true;
    controls.push(...Array.from({ length: 40 }, (_, i) => new Element(`filler-${i}`)), late);
    const outsideBody = await gui.failureEvidence('[data-testid="late-target"]');
    const limitedBody = JSON.parse(
      await readFile(
        outsideBody.artifacts.find((file) => file.endsWith(".dom.json"))!,
        "utf8",
      ),
    );
    assert.equal(limitedBody.elements.length, 40);
    assert.ok(!JSON.stringify(limitedBody).includes("late-target"));
    assert.equal(outsideBody.target?.inspection?.elements[0].disabled, true);
    assert.equal(outsideBody.target?.inspection?.elements[0].bounds!.x, 300);
    assert.equal(outsideBody.target?.inspection?.elements[0].center_hit!.status, "covered");
    const redacted = await gui.failureEvidence('[data-testid="password"]');
    assert.equal(redacted.target?.inspection?.elements[0].value, "[redacted]");
    const missing = await gui.failureEvidence("#missing");
    assert.match(missing.target?.unavailable ?? "", /Target absent: #missing/);
    assert.deepEqual(missing.errors, []);
    assert.equal(missing.artifacts.length, 3);
  } finally {
    await rm(gui.workspace, { recursive: true, force: true });
  }
});

test("log tails bound reads at source, reject path/symlink escapes and retain diagnostics after close", async () => {
  const base = path.join(tmpdir(), "opencode");
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, "native-gui-diagnostics-test-"));
  const workspace = path.join(root, "workspace");
  await mkdir(workspace);
  try {
    const filename = path.join(workspace, "driver.log");
    const file = await open(filename, "w");
    await file.truncate(512 * 1024 * 1024); // Sparse file: tail must not allocate/read whole log.
    await file.write(
      Array.from({ length: 150 }, (_, i) => `record-${i}\n`).join(""),
      512 * 1024 * 1024 - 1540,
    );
    await file.close();
    const tail = await tailLog(workspace, "driver.log");
    assert.ok(typeof tail.text === "string" && typeof tail.read_bytes === "number");
    assert.ok(tail.read_bytes <= LOG_BYTES);
    assert.ok(tail.text.split("\n").length <= LOG_LINES);
    assert.equal(tail.truncated, true);
    assert.match(tail.text, /record-149/);
    for (const record of ["x".repeat(LOG_BYTES * 2), "€".repeat(LOG_BYTES)]) {
      for (const ending of ["", "\n"]) {
        await writeFile(path.join(workspace, "long.log"), `${record}last-error${ending}`);
        const long = await tailLog(workspace, "long.log");
        assert.equal(long.read_bytes, LOG_BYTES);
        assert.equal(long.truncated, true);
        assert.ok(long.text?.endsWith("last-error"));
        assert.ok(!long.text?.includes("\ufffd"), "Tail starts with a split UTF-8 codepoint.");
      }
    }
    assert.ok("unavailable" in (await tailLog(workspace, "missing.log")));
    await writeFile(path.join(root, "secret"), "not allowed");
    await symlink(path.join(root, "secret"), path.join(workspace, "link.log"));
    await symlink(root, path.join(workspace, "linked"));
    for (const relative of ["../secret", "link.log", "linked/secret"]) {
      const result = await tailLog(workspace, relative);
      assert.ok("unavailable" in result);
      assert.ok(!JSON.stringify(result).includes("not allowed"));
    }
    await symlink(root, path.join(workspace, "failures"));
    await assert.rejects(saveArtifact(workspace, "failures/test.json", "not allowed"), /Symlinked/);
    const gui = new NativeGuiSession();
    gui.workspace = workspace;
    await gui.close();
    const diagnostics = await gui.diagnostics();
    assert.equal(diagnostics.driver.process_running, false);
    assert.equal(diagnostics.live.reachable, false);
    assert.equal(diagnostics.logs.length, 3);
    assert.ok(diagnostics.logs.some((log) => log.text?.includes("record-149")));
    const evidence = await gui.failureEvidence();
    assert.equal(evidence.artifacts.length, 0);
    assert.match(evidence.errors.join(" "), /Symlinked/);

    const xkb = [
      "The XKEYBOARD keymap compiler (xkbcomp) reports:",
      "> Warning:          Could not resolve keysym XF86CameraAccessEnable",
      "> Warning:          Could not resolve keysym XF86AutopilotEngageToggle",
      "> Warning:          Could not resolve keysym XF86NavInfo",
      "Errors from xkbcomp are not fatal to the X server",
    ].join("\n");
    const summary = "[Known nonfatal XKB keysym warnings omitted; original driver.log unchanged]";
    const raw = `X11 connection failed\n${xkb}\nWebDriverError: click failed\n${xkb}\n`;
    await writeFile(filename, raw);
    const expected = raw.replaceAll(xkb, summary).trimEnd();
    assert.equal((await tailLog(workspace, "driver.log")).text, expected);
    assert.equal((await gui.diagnostics()).logs[0].text, expected);
    assert.equal((await gui.failureEvidence()).diagnostics.logs[0].text, expected);
    assert.equal(await readFile(filename, "utf8"), raw);
    await writeFile(path.join(workspace, "app.log"), raw);
    assert.equal((await tailLog(workspace, "app.log")).text, raw.trimEnd());
    for (const block of [
      xkb.replace("XF86NavInfo", "XF86UnknownFutureKey"),
      xkb.replace("reports:\n", "reports:\n> Error: keymap compilation failed\n"),
      xkb.slice(0, xkb.lastIndexOf("\n")),
      xkb.slice(xkb.indexOf("\n") + 1),
    ]) {
      await writeFile(filename, block);
      assert.equal((await tailLog(workspace, "driver.log")).text, block);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("unresponsive cached browser is not live; diagnostics and failure probes have deadlines", async () => {
  const http = createHttpServer(() => {
    /* Intentionally never answer protocol requests. */
  });
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const gui = new NativeGuiSession();
  Object.defineProperties(gui, {
    connection: { value: { sessionId: "dead" }, writable: true },
    port: { value: (http.address() as { port: number }).port },
  });
  const base = path.join(tmpdir(), "opencode");
  await mkdir(base, { recursive: true });
  gui.workspace = await mkdtemp(path.join(base, "native-gui-dead-test-"));
  try {
    const start = Date.now();
    const evidence = await gui.failureEvidence("#target");
    assert.equal(evidence.diagnostics.live.reachable, false);
    assert.equal(evidence.diagnostics.driver.process_running, false);
    assert.equal(evidence.errors.length, 2);
    assert.equal(evidence.target?.selector, "#target");
    assert.ok(evidence.target?.unavailable);
    assert.equal(evidence.artifacts.length, 1); // Offline diagnostics still saved.
    assert.ok(Date.now() - start < 5000, "Evidence inherited an unbounded browser timeout.");
  } finally {
    await gui.stopDriver();
    http.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      http.close((error) => (error ? reject(error) : resolve())),
    );
    await rm(gui.workspace, { recursive: true, force: true });
  }
});

test("tool failure forwards its selector and keeps original error if evidence fails; sessions stay separate", async (context) => {
  const captured: { gui: NativeGuiSession; selector: string | undefined }[] = [];
  context.mock.method(
    NativeGuiSession.prototype,
    "failureEvidence",
    async function (this: NativeGuiSession, selector?: string) {
      captured.push({ gui: this, selector });
      throw new Error("capture failed");
    },
  );
  const { server, shutdown } = createServer();
  const client = new Client({ name: "failure-test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b);
  await client.connect(a);
  try {
    for (const [session, selector] of [
      ["a", "#first"],
      ["b", "#second"],
      ["a", "#third"],
    ]) {
      const result = await client.callTool({
        name: "click",
        arguments: { selector },
        _meta: { "ai.opencode/sessionID": session },
      });
      assert.equal(result.isError, true);
      const value = JSON.parse((result.content as { text: string }[])[0].text);
      assert.equal(value.error, "Launch the native GUI first.");
      assert.equal(value.input, "not_sent");
      assert.equal(value.evidence.unavailable, "capture failed");
    }
    assert.notEqual(captured[0].gui, captured[1].gui);
    assert.equal(captured[0].gui, captured[2].gui);
    assert.deepEqual(
      captured.map((entry) => entry.selector),
      ["#first", "#second", "#third"],
    );
  } finally {
    await shutdown();
    await client.close();
    await server.close();
  }
});

test("input failures report delivery phase; successful input returns observed state", async (context) => {
  context.mock.method(NativeGuiSession.prototype, "failureEvidence", async () => ({}));
  const observe = context.mock.method(NativeGuiSession.prototype, "observe", async () => ({
    route: "/overview",
    focus: '[data-testid="save"]',
  }));
  let failure: Error | undefined;
  context.mock.method(NativeGuiSession.prototype, "click", async function (this: NativeGuiSession) {
    if (failure) await this.dispatch(async () => Promise.reject(failure));
  });
  const { server, shutdown } = createServer();
  const client = new Client({ name: "input-phase-test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b);
  await client.connect(a);
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args });
    return {
      isError: result.isError,
      value: JSON.parse((result.content as { text: string }[])[0].text),
    };
  };
  try {
    assert.deepEqual(await call("click", { selector: "#save" }), {
      isError: undefined,
      value: { clicked: "#save", observed: { route: "/overview", focus: '[data-testid="save"]' } },
    });
    assert.deepEqual(observe.mock.calls[0].arguments, []);
    failure = new Error("native click failed");
    const sent = await call("click", { selector: "#save" });
    assert.equal(sent.isError, true);
    assert.equal(sent.value.error, "native click failed");
    assert.equal(sent.value.input, "possibly_sent");
    assert.equal(observe.mock.callCount(), 1); // No observation replaces a failed input.
    const inspected = await call("inspect", {});
    assert.equal(inspected.isError, true);
    assert.ok(!("input" in inspected.value));
  } finally {
    await shutdown();
    await client.close();
    await server.close();
  }
});

test("observed state reports route, non-body focus and redacted target values", () => {
  const input = { type: "password", value: "secret", getAttribute: () => "pw" };
  const document = {
    body: {},
    activeElement: input,
    querySelectorAll: (css: string) =>
      css === "#pw" || css === '[data-testid="pw"]'
        ? [input]
        : css === "#many"
          ? [input, input]
          : [],
  };
  // JSON round trip mirrors WebDriver result serialization.
  const observe = (selector: string | null) =>
    JSON.parse(
      JSON.stringify(
        vm.runInNewContext(`(function () { ${pageScript(observeState)} }).apply(null, args)`, {
          args: [selector],
          document,
          location: { hash: "#/overview" },
        }),
      ),
    ) as ReturnType<typeof observeState>;
  assert.deepEqual(observe("#pw"), {
    route: "/overview",
    focus: '[data-testid="pw"]',
    value: "[redacted]",
  });
  assert.equal(observe("#many").value, null);
  document.activeElement = document.body as typeof input;
  assert.deepEqual(observe(null), { route: "/overview", focus: null });
});

test("launch errors reuse evidence captured before driver cleanup", async (context) => {
  const evidence = { artifacts: ["startup.png", "startup.dom.json"], errors: [] };
  const original = Object.assign(new Error("startup failed"), { evidence });
  context.mock.method(NativeGuiSession.prototype, "launch", async () => {
    throw original;
  });
  const recapture = context.mock.method(NativeGuiSession.prototype, "failureEvidence", async () => {
    throw new Error("Driver already stopped; do not recapture.");
  });
  const { server, shutdown } = createServer();
  const client = new Client({ name: "startup-failure-test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b);
  await client.connect(a);
  try {
    const result = await client.callTool({ name: "launch", arguments: {} });
    assert.equal(result.isError, true);
    assert.deepEqual(JSON.parse((result.content as { text: string }[])[0].text), {
      error: original.message,
      evidence,
    });
    assert.equal(recapture.mock.callCount(), 0);
    assert.notEqual((await client.callTool({ name: "close", arguments: {} })).isError, true);
  } finally {
    await shutdown();
    await client.close();
    await server.close();
  }
});

test("PNG metadata validates signature and reports image pixels", () => {
  const png = Buffer.alloc(24);
  Buffer.from("89504e470d0a1a0a", "hex").copy(png);
  png.write("IHDR", 12);
  png.writeUInt32BE(3840, 16);
  png.writeUInt32BE(2160, 20);
  assert.deepEqual(pngDimensions(png.toString("base64")), {
    width: 3840,
    height: 2160,
    units: "image pixels",
  });
  assert.throws(() => pngDimensions("not a PNG"), /not a PNG/);
});

test("normal close refuses failed project shutdown without deleting browser session", async (context) => {
  const gui = new NativeGuiSession();
  const browser = {
    execute: async () => {
      throw new Error("project shutdown refused");
    },
    deleteSession: context.mock.fn(),
  };
  Object.defineProperty(gui, "connection", { value: browser });
  const stop = context.mock.method(gui, "stopDriver");
  await assert.rejects(gui.close(), /project shutdown refused/);
  assert.equal(browser.deleteSession.mock.callCount(), 0);
  assert.equal(stop.mock.callCount(), 0);
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

test("element helper waits for async existence, rejects ambiguity and optionally centers controls", async () => {
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
      execute: async (script: unknown, selector: string) =>
        typeof script === "string"
          ? vm.runInNewContext(`(function () { ${script} }).apply(null, args)`, {
              args: [selector],
              HTMLElement: class {},
              document: {
                querySelectorAll: () =>
                  ["save", "cancel"].map((name) => ({
                    tagName: "BUTTON",
                    innerText: ` ${name}\n button `,
                    getAttribute: (key: string) => (key === "data-testid" ? name : null),
                  })),
              },
            })
          : count,
      $: () => element,
      waitUntil: async (condition: () => Promise<boolean>) => {
        calls.push("wait");
        assert.equal(await condition(), false);
        count = 1;
        assert.equal(await condition(), true);
      },
    },
  });
  assert.equal(await gui.element("#target"), element);
  assert.deepEqual(calls, ["visible", { block: "center", inline: "center" }]);
  count = 2;
  await assert.rejects(
    gui.element("button"),
    /matched 2 elements; narrow the CSS selector\. First matches: button:nth-of-type\(1\) "save button"; button:nth-of-type\(1\) "cancel button"/,
  );
  count = 0;
  calls.length = 0;
  assert.equal(await gui.element("#later", false), element);
  assert.deepEqual(calls, ["wait", "visible"]);
});

test("pointer offsets use CSS geometry, reject covered/outside points, and wheel targeting does not recenter", async (context) => {
  const gui = new NativeGuiSession();
  const resolved = context.mock.method(gui, "element", async () => ({}) as never);
  let covered = false;
  const element = {
    getBoundingClientRect: () => ({
      left: 100,
      top: 50,
      right: 300,
      bottom: 150,
      width: 200,
      height: 100,
    }),
    contains: (hit: unknown) => hit === element,
  };
  Object.defineProperty(gui, "browser", {
    value: {
      execute: async (fn: (...args: never[]) => unknown, ...args: unknown[]) =>
        vm.runInNewContext(`(${fn.toString()})(...args)`, {
          args,
          innerWidth: 800,
          innerHeight: 600,
          document: {
            querySelectorAll: () => [element],
            elementFromPoint: () => (covered ? {} : element),
          },
        }),
    },
  });
  assert.equal(
    JSON.stringify(await gui.pointerPoints("#canvas", [{ x: 30, y: 40 }])),
    '[{"x":130,"y":90}]',
  );
  assert.equal(
    JSON.stringify(await gui.pointerPoints("#canvas", [undefined], false)),
    '[{"x":200,"y":100}]',
  );
  assert.deepEqual(resolved.mock.calls[1].arguments, ["#canvas", false]);
  await assert.rejects(gui.pointerPoints("#canvas", [{ x: 200, y: 1 }]), /outside the target/);
  covered = true;
  await assert.rejects(gui.pointerPoints("#canvas", [{ x: 1, y: 1 }]), /covered/);
});

test("failed pointer input releases held buttons without replacing its error or repeating input", async () => {
  const gui = new NativeGuiSession();
  let releases = 0;
  let inputs = 0;
  const error = new Error("native action failed");
  Object.defineProperty(gui, "browser", {
    value: {
      releaseActions: async () => {
        releases++;
        throw new Error("release also failed");
      },
    },
  });
  await assert.rejects(
    gui.performInput({
      perform: async () => {
        inputs++;
        throw error;
      },
    }),
    (actual) => actual === error,
  );
  assert.equal(inputs, 1);
  assert.equal(releases, 1);
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

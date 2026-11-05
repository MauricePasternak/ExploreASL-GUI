import { constants } from "node:fs";
import { mkdir, open, realpath } from "node:fs/promises";
import path from "node:path";

export const LOG_BYTES = 16_384;
export const LOG_LINES = 100;
export const errorText = (error: unknown) =>
  String(error instanceof Error ? error.message : error).slice(0, 2000);

// Collapse only complete, recognized nonfatal blocks; leave new warnings and errors visible.
const XKB_NOISE = new RegExp(
  "^The XKEYBOARD keymap compiler \\(xkbcomp\\) reports:\\n" +
    "(?:> Warning: +Could not resolve keysym XF86(?:" +
    "CameraAccess(?:Enable|Disable|Toggle)|NextElement|PreviousElement|AutopilotEngageToggle|" +
    "MarkWaypoint|Sos|NavChart|FishingChart|SingleRangeRadar|DualRangeRadar|RadarOverlay|" +
    "TraditionalSonar|ClearvuSonar|SidevuSonar|NavInfo)\\n)+" +
    "Errors from xkbcomp are not fatal to the X server(?=\\n|$)",
  "gm",
);
const IGNORED_DRIVER_LINES = new Set([
  "_XSERVTransmkdir: ERROR: euid != 0,directory /tmp/.X11-unix will not be created.",
  "libEGL warning: DRI3 error: Could not get DRI3 device",
  "libEGL warning: Ensure your X server supports DRI3 to get accelerated rendering",
]);

// Linux-only controller: verify the opened descriptor, not just a pre-open path check.
async function ownedFile(workspace: string, relative: string, flags: number) {
  if ((await realpath(workspace)) !== workspace)
    throw new Error("Workspace is no longer canonical.");
  const filename = path.resolve(workspace, relative);
  if (!filename.startsWith(`${workspace}${path.sep}`)) throw new Error("Path escapes workspace.");
  if ((await realpath(path.dirname(filename))) !== path.dirname(filename))
    throw new Error("Symlinked artifact/log directory refused.");
  const file = await open(filename, flags | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
  try {
    if (!(await file.stat()).isFile() || (await realpath(`/proc/self/fd/${file.fd}`)) !== filename)
      throw new Error("Artifact/log is not an owned regular file.");
    return { file, filename };
  } catch (error) {
    await file.close();
    throw error;
  }
}

export async function tailLog(workspace: string, relative: string) {
  try {
    const { file, filename } = await ownedFile(workspace, relative, constants.O_RDONLY);
    try {
      const size = (await file.stat()).size;
      const buffer = Buffer.alloc(Math.min(size, LOG_BYTES));
      const { bytesRead } = await file.read(
        buffer,
        0,
        buffer.length,
        Math.max(0, size - LOG_BYTES),
      );
      // Keep partial records, but skip leading continuation bytes of a split UTF-8 codepoint.
      let start = 0;
      if (size > LOG_BYTES) {
        while (start < bytesRead && (buffer[start] & 0xc0) === 0x80) start++;
      }
      const raw = buffer.subarray(start, bytesRead).toString("utf8");
      const text =
        relative === "driver.log"
          ? raw.replace(
              XKB_NOISE,
              "[Known nonfatal XKB keysym warnings omitted; original driver.log unchanged]",
            )
          : raw;
      const lines = text
        .replace(/\n$/, "")
        .split("\n")
        .filter((line) => relative !== "driver.log" || !IGNORED_DRIVER_LINES.has(line));
      return {
        path: filename,
        size_bytes: size,
        read_bytes: bytesRead,
        truncated: size > LOG_BYTES || lines.length > LOG_LINES,
        text: lines.slice(-LOG_LINES).join("\n"),
      };
    } finally {
      await file.close();
    }
  } catch (error) {
    return { path: path.join(workspace, relative), unavailable: errorText(error) };
  }
}

export async function saveArtifact(workspace: string, relative: string, data: string | Buffer) {
  if (!["screenshots", "failures"].includes(path.dirname(relative)))
    throw new Error("Unsupported artifact directory.");
  if ((await realpath(workspace)) !== workspace)
    throw new Error("Workspace is no longer canonical.");
  const directory = path.dirname(path.resolve(workspace, relative));
  if (!directory.startsWith(`${workspace}${path.sep}`)) throw new Error("Path escapes workspace.");
  await mkdir(directory, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "EEXIST") throw error;
  });
  const { file, filename } = await ownedFile(
    workspace,
    relative,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
  );
  try {
    await file.writeFile(data);
    return filename;
  } finally {
    await file.close();
  }
}

export function pngDimensions(image: string) {
  const buffer = Buffer.from(image, "base64");
  if (
    buffer.length < 24 ||
    buffer.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" ||
    buffer.toString("ascii", 12, 16) !== "IHDR"
  )
    throw new Error("Screenshot is not a PNG.");
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20), units: "image pixels" };
}

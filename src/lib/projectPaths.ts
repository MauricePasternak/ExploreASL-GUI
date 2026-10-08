import { invoke } from "@tauri-apps/api/core";

export type PathOwnership = "internal" | "external" | "missing";

export interface SourcePathInspection {
  absolutePath: string;
  exists: boolean;
  readable: boolean;
  isDirectory: boolean;
  ownership: PathOwnership;
  projectRelativePath: string | null;
}

const WINDOWS_DRIVE_ABSOLUTE = /^[A-Za-z]:[\\/]/;
const WINDOWS_UNC_ABSOLUTE = /^(?:\\\\|\/\/)[^\\/]+[\\/][^\\/]+/;

export function isAbsolutePath(path: string): boolean {
  return (
    path.startsWith("/") || WINDOWS_DRIVE_ABSOLUTE.test(path) || WINDOWS_UNC_ABSOLUTE.test(path)
  );
}

function relativeSegments(path: string): string[] {
  if (isAbsolutePath(path)) {
    throw new Error(`Path must be relative: ${path}`);
  }

  const segments = path
    .replace(/\\/g, "/")
    .split("/")
    .filter((segment) => segment.length > 0 && segment !== ".");

  if (segments.includes("..")) {
    throw new Error(`Relative path cannot escape its root: ${path}`);
  }
  return segments;
}

export function canonicalInternalSource(path: string): string {
  const segments = relativeSegments(path);
  return segments.length === 0 ? "." : `./${segments.join("/")}`;
}

export function normalizeRawPath(path: string): string {
  const segments = relativeSegments(path);
  if (segments.length === 0) throw new Error("Raw path must identify an entry below its source.");
  return segments.join("/");
}

function joinHostPath(root: string, segments: string[]): string {
  if (segments.length === 0) return root;
  const separator = WINDOWS_DRIVE_ABSOLUTE.test(root) || root.startsWith("\\\\") ? "\\" : "/";
  const trimmedRoot = root.replace(/[\\/]+$/, "");
  return `${trimmedRoot}${separator}${segments.join(separator)}`;
}

export function resolveLogicalSource(
  projectRoot: string,
  sourceDataPath: string,
  dataSource: "dicom" | "bids",
): string {
  if (dataSource === "bids") return projectRoot;
  if (isAbsolutePath(sourceDataPath)) return sourceDataPath;
  return joinHostPath(projectRoot, relativeSegments(sourceDataPath));
}

export function resolveRawPath(sourceRoot: string, rawPath: string): string {
  return joinHostPath(sourceRoot, relativeSegments(normalizeRawPath(rawPath)));
}

export function logicalSourceIdentity(sourcePath: string): string {
  if (!isAbsolutePath(sourcePath)) return canonicalInternalSource(sourcePath);
  const normalized = sourcePath.replace(/\\/g, "/").replace(/\/$/, "");
  return WINDOWS_DRIVE_ABSOLUTE.test(sourcePath) || WINDOWS_UNC_ABSOLUTE.test(sourcePath)
    ? normalized.toLowerCase()
    : normalized;
}

export async function inspectSourcePath(
  projectRoot: string,
  sourcePath: string,
): Promise<SourcePathInspection> {
  return invoke<SourcePathInspection>("inspect_source_path", { projectRoot, sourcePath });
}

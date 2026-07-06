import { exists, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";

export const BIDS_IGNORE_ENTRIES = ["project.easl", ".easl_staging"];

/**
 * Checks if a directory is a BIDS project by checking for the presence of
 * a `dataset_description.json` file in the root directory.
 */
export async function isBidsProject(rootPath: string): Promise<boolean> {
  const datasetDescriptionPath = `${rootPath}/dataset_description.json`;
  try {
    return await exists(datasetDescriptionPath);
  } catch {
    return false;
  }
}

/**
 * Ensures that the GUI-specific files/directories are present in the `.bidsignore` file.
 * If `.bidsignore` does not exist, it creates it with the default banned files.
 * If it does exist, it appends the missing banned files.
 */
export async function ensureBidsIgnore(rootPath: string): Promise<void> {
  const bidsIgnorePath = `${rootPath}/.bidsignore`;
  let existingContent = "";

  try {
    if (await exists(bidsIgnorePath)) {
      existingContent = await readTextFile(bidsIgnorePath);
    }
  } catch {
    // If check or read fails, treat as not existing or empty
  }

  // Parse lines, normalize them by trimming whitespace.
  const lines = existingContent.split(/\r?\n/).map((line) => line.trim());

  // Find which entries are missing
  const missingEntries = BIDS_IGNORE_ENTRIES.filter((entry) => !lines.includes(entry));

  if (missingEntries.length === 0) {
    // All entries are already in .bidsignore, nothing to do.
    return;
  }

  // Build the new content.
  let newContent = existingContent;
  if (newContent && !newContent.endsWith("\n")) {
    newContent += "\n";
  }
  newContent += missingEntries.join("\n") + "\n";

  await writeTextFile(bidsIgnorePath, newContent);
}

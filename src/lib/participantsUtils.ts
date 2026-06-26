import { exists, readTextFile, writeTextFile, mkdir } from "@tauri-apps/plugin-fs";
import type { ProcessConfig, SubjectInfo } from "../schemas/processingSchemas";

/**
 * Parses a participant_id (e.g. sub-C9ORF007Philips_01) into subject and session.
 * The session is assumed to be the last part of the string after the last underscore.
 */
export function parseParticipantId(participantId: string): { subject: string; session: string } {
  const cleanId = participantId.startsWith("sub-") ? participantId.slice(4) : participantId;
  const lastUnderscore = cleanId.lastIndexOf("_");
  if (lastUnderscore === -1) {
    return { subject: cleanId, session: "01" };
  }
  return {
    subject: cleanId.substring(0, lastUnderscore),
    session: cleanId.substring(lastUnderscore + 1),
  };
}

const DEFAULT_PARTICIPANTS_JSON = {
  participant_id: {
    Description:
      "Unique participant identifier, including _session suffix (==visit in ExploreASL legacy)",
  },
  session: {
    Description: "Unique run identifier (== session in ExploreASL legacy)",
  },
  site: {
    Description: "Site identifier",
  },
  gm_vol: {
    Description: "Gray matter volume of the participant at this visit",
    Units: "liter",
  },
  wm_vol: {
    Description: "White matter volume of the participant at this visit",
    Units: "liter",
  },
  csf_vol: {
    Description: "Cerebrospinal fluid volume of the participant at this visit",
    Units: "liter",
  },
  gm_icv_ratio: {
    Description:
      "Ratio of gray matter volume to the intracranial volume of the participant at this visit, proxy of gray matter atrophy",
    Units: "ratio",
  },
  gmwm_icv_ratio: {
    Description:
      "Ratio of parenchymal volume (gray matter + WM volume) to the intracranial volume of the participant at this visit, proxy of wholebrain atrophy",
    Units: "ratio",
  },
  motion: {
    Description: "Mean net displacement vector difference (head motion) of this ASL scan",
    Units: "mm RMS",
  },
};

/**
 * Ensures that participants.tsv and participants.json exist in <projectRoot>/derivatives/ExploreASL
 * and contain the required columns (participant_id, session, site). If they exist,
 * merges, updates, and sorts them accordingly.
 */
export async function ensureParticipantsFiles(
  projectRoot: string,
  config: ProcessConfig,
  mappingState: any,
  availableSubjects: SubjectInfo[],
  enabled: boolean = false,
): Promise<void> {
  const derivativesDir = `${projectRoot}/derivatives/ExploreASL`;
  const tsvPath = `${derivativesDir}/participants.tsv`;
  const jsonPath = `${derivativesDir}/participants.json`;

  if (!enabled) {
    // Strip site column if files exist
    try {
      if (await exists(tsvPath)) {
        const content = await readTextFile(tsvPath);
        const lines = content
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean);
        if (lines.length > 0) {
          const headers = lines[0].split("\t").map((h) => h.trim());
          const siteIndex = headers.indexOf("site");
          if (siteIndex !== -1) {
            headers.splice(siteIndex, 1);
            const nextLines = [headers.join("\t")];
            for (let i = 1; i < lines.length; i++) {
              const cols = lines[i].split("\t");
              cols.splice(siteIndex, 1);
              nextLines.push(cols.join("\t"));
            }
            await writeTextFile(tsvPath, nextLines.join("\n") + "\n");
          }
        }
      }
    } catch (err) {
      console.warn("Failed to strip site column from participants.tsv:", err);
    }

    try {
      if (await exists(jsonPath)) {
        const rawJson = await readTextFile(jsonPath);
        const parsedJson = JSON.parse(rawJson);
        if (parsedJson && typeof parsedJson === "object" && "site" in parsedJson) {
          delete parsedJson.site;
          await writeTextFile(jsonPath, JSON.stringify(parsedJson, null, 2));
        }
      }
    } catch (err) {
      console.warn("Failed to remove site from participants.json:", err);
    }

    return;
  }

  // 1. Ensure the directory exists
  try {
    if (!(await exists(derivativesDir))) {
      await mkdir(derivativesDir, { recursive: true });
    }
  } catch (err) {
    console.error("Failed to create derivatives directory:", err);
  }

  // 2. Parse existing TSV if it exists
  let existingHeaders: string[] = [];
  let existingRows: Record<string, string>[] = [];

  try {
    if (await exists(tsvPath)) {
      const content = await readTextFile(tsvPath);
      const lines = content
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      if (lines.length > 0) {
        existingHeaders = lines[0].split("\t").map((h) => h.trim());
        existingRows = lines.slice(1).map((line) => {
          const cols = line.split("\t");
          const row: Record<string, string> = {};
          existingHeaders.forEach((h, idx) => {
            row[h] = cols[idx] !== undefined ? cols[idx].trim() : "";
          });
          return row;
        });
      }
    }
  } catch (err) {
    console.warn("Failed to read existing participants.tsv (will overwrite):", err);
  }

  // 3. Build target rows
  const subjectRows = mappingState?.subjectRows || [];
  const metadataGroups = mappingState?.metadataGroups || [];

  const targetRows: { participant_id: string; session: string; site: string }[] = [];

  for (const subjectSession of config.subjects) {
    // Determine runs
    const avail = availableSubjects.find((s) => s.subjectSession === subjectSession);
    const runs = avail && avail.aslRuns && avail.aslRuns.length > 0 ? avail.aslRuns : ["1"];

    // Determine subject and session from participant_id
    const { subject, session } = parseParticipantId(subjectSession);

    // Determine site mapping
    const rowMatch = subjectRows.find((r: any) => r.subject === subject && r.session === session);
    let siteVal = "";
    if (rowMatch) {
      const groupMatch = metadataGroups.find((g: any) => g.id === rowMatch.groupId);
      if (groupMatch) {
        siteVal = groupMatch.label.trim().replace(/\s+/g, "_");
      } else if (rowMatch.groupId === "global-defaults") {
        siteVal = "Global_Defaults";
      }
    }

    for (const run of runs) {
      const runVal = run.startsWith("ASL_") ? run : `ASL_${run}`;
      targetRows.push({
        participant_id: subjectSession,
        session: runVal,
        site: siteVal,
      });
    }
  }

  // 4. Merge target rows into existing rows
  for (const target of targetRows) {
    let found = false;
    for (const row of existingRows) {
      if (row.participant_id === target.participant_id && row.session === target.session) {
        row.site = target.site;
        found = true;
        break;
      }
    }
    if (!found) {
      existingRows.push({
        participant_id: target.participant_id,
        session: target.session,
        site: target.site,
      });
    }
  }

  // 5. Sort all rows by participant_id then session
  existingRows.sort((a, b) => {
    const pidA = a.participant_id || "";
    const pidB = b.participant_id || "";
    const cmp = pidA.localeCompare(pidB);
    if (cmp !== 0) return cmp;
    const sesA = a.session || "";
    const sesB = b.session || "";
    return sesA.localeCompare(sesB);
  });

  // 6. Build final headers list (participant_id, session, site, then others)
  const standardHeaders = ["participant_id", "session", "site"];
  const otherHeaders = existingHeaders.filter((h) => !standardHeaders.includes(h));
  const finalHeaders = [...standardHeaders, ...otherHeaders];

  // 7. Generate TSV content
  const tsvLines = [finalHeaders.join("\t")];
  for (const row of existingRows) {
    const lineCols = finalHeaders.map((h) => row[h] ?? "");
    tsvLines.push(lineCols.join("\t"));
  }
  const tsvContent = tsvLines.join("\n") + "\n";

  // 8. Write TSV file
  await writeTextFile(tsvPath, tsvContent);

  // 9. Generate/Update JSON file
  let jsonContentObj: any = { ...DEFAULT_PARTICIPANTS_JSON };
  try {
    if (await exists(jsonPath)) {
      const rawJson = await readTextFile(jsonPath);
      const parsedJson = JSON.parse(rawJson);
      if (parsedJson && typeof parsedJson === "object") {
        jsonContentObj = { ...DEFAULT_PARTICIPANTS_JSON, ...parsedJson };
      }
    }
  } catch (err) {
    console.warn("Failed to read existing participants.json (will write default):", err);
  }

  await writeTextFile(jsonPath, JSON.stringify(jsonContentObj, null, 2));
}

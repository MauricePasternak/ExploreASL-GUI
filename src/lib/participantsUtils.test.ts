import { exists, mkdir, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProcessConfig, SubjectInfo } from "../schemas/processingSchemas";
import { ensureParticipantsFiles, parseParticipantId } from "./participantsUtils";

vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: vi.fn(),
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
  mkdir: vi.fn(),
}));

describe("participantsUtils", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("parseParticipantId", () => {
    it("parses BIDS-compliant participant ID with prefix and visit session", () => {
      expect(parseParticipantId("sub-001Philips_01")).toEqual({
        subject: "001Philips",
        session: "01",
      });
    });

    it("parses participant ID without sub- prefix", () => {
      expect(parseParticipantId("002Siemens_12")).toEqual({
        subject: "002Siemens",
        session: "12",
      });
    });

    it("handles subject name containing multiple underscores", () => {
      expect(parseParticipantId("sub-C9_ORF_007_Philips_02")).toEqual({
        subject: "C9_ORF_007_Philips",
        session: "02",
      });
    });

    it("falls back to default session if no session suffix exists", () => {
      expect(parseParticipantId("sub-001")).toEqual({
        subject: "001",
        session: "01",
      });
    });
  });

  describe("ensureParticipantsFiles", () => {
    const config: ProcessConfig = {
      subjects: ["sub-001Philips_01", "sub-002Siemens_02"],
      modules: ["structural", "asl"],
      selectedProfileId: "profile-1",
      workers: 4,
    };

    const mappingState = {
      subjectRows: [
        {
          id: "001Philips/01",
          subject: "001Philips",
          session: "01",
          groupId: "group-philips",
        },
        {
          id: "002Siemens/02",
          subject: "002Siemens",
          session: "02",
          groupId: "global-defaults",
        },
      ],
      metadataGroups: [
        {
          id: "group-philips",
          label: "Philips Override",
          bidsParams: {},
        },
        {
          id: "global-defaults",
          label: "Global Defaults",
          bidsParams: {},
        },
      ],
    };

    const availableSubjects: SubjectInfo[] = [
      {
        subjectSession: "sub-001Philips_01",
        subject: "001Philips",
        session: "01",
        hasStructural: true,
        hasASL: true,
        aslRuns: ["1", "2"],
      },
      {
        subjectSession: "sub-002Siemens_02",
        subject: "002Siemens",
        session: "02",
        hasStructural: true,
        hasASL: true,
        aslRuns: ["1"],
      },
    ];

    it("creates TSV and JSON files with correct values when they do not exist", async () => {
      vi.mocked(exists).mockResolvedValue(false);

      await ensureParticipantsFiles("/test/project", config, mappingState, availableSubjects, true);

      // Verify directory check/creation
      expect(exists).toHaveBeenCalledWith("/test/project/derivatives/ExploreASL");
      expect(mkdir).toHaveBeenCalledWith("/test/project/derivatives/ExploreASL", {
        recursive: true,
      });

      // Verify TSV content
      expect(writeTextFile).toHaveBeenCalledWith(
        "/test/project/derivatives/ExploreASL/participants.tsv",
        "participant_id\tsession\tsite\n" +
          "sub-001Philips_01\tASL_1\tPhilips_Override\n" +
          "sub-001Philips_01\tASL_2\tPhilips_Override\n" +
          "sub-002Siemens_02\tASL_1\tGlobal_Defaults\n",
      );

      // Verify JSON content
      expect(writeTextFile).toHaveBeenCalledWith(
        "/test/project/derivatives/ExploreASL/participants.json",
        expect.stringContaining('"participant_id":'),
      );
      expect(writeTextFile).toHaveBeenCalledWith(
        "/test/project/derivatives/ExploreASL/participants.json",
        expect.stringContaining('"site":'),
      );
    });

    it("updates, merges, and sorts pre-existing TSV content correctly", async () => {
      // Setup: TSV exists and has custom columns and mixed-up rows
      const existingTsv =
        "participant_id\tsession\tGM_vol\tWM_vol\n" +
        "sub-002Siemens_02\tASL_1\t0.67894\t0.5418\n" +
        "sub-001Philips_01\tASL_1\t0.63988\t0.48649\n";

      const existingJson = JSON.stringify({
        participant_id: { Description: "custom id desc" },
        custom_column: { Description: "a custom measurement" },
      });

      vi.mocked(exists).mockImplementation(async (path) => {
        if (path.toString().endsWith("participants.tsv")) return true;
        if (path.toString().endsWith("participants.json")) return true;
        if (path.toString().endsWith("ExploreASL")) return true;
        return false;
      });

      vi.mocked(readTextFile).mockImplementation(async (path) => {
        if (path.toString().endsWith("participants.tsv")) return existingTsv;
        if (path.toString().endsWith("participants.json")) return existingJson;
        return "";
      });

      await ensureParticipantsFiles("/test/project", config, mappingState, availableSubjects, true);

      // Verify TSV content is merged, columns preserved, site updated/added, and sorted
      expect(writeTextFile).toHaveBeenCalledWith(
        "/test/project/derivatives/ExploreASL/participants.tsv",
        "participant_id\tsession\tsite\tGM_vol\tWM_vol\n" +
          "sub-001Philips_01\tASL_1\tPhilips_Override\t0.63988\t0.48649\n" +
          "sub-001Philips_01\tASL_2\tPhilips_Override\t\t\n" +
          "sub-002Siemens_02\tASL_1\tGlobal_Defaults\t0.67894\t0.5418\n",
      );

      // Verify JSON content is merged, custom fields preserved, standard ones added
      const writtenJsonCall = vi
        .mocked(writeTextFile)
        .mock.calls.find((call) => call[0].toString().endsWith("participants.json"));
      expect(writtenJsonCall).toBeDefined();
      const parsedJson = JSON.parse(writtenJsonCall![1] as string);
      expect(parsedJson.participant_id.Description).toBe("custom id desc"); // Preserved existing
      expect(parsedJson.custom_column.Description).toBe("a custom measurement"); // Preserved existing
      expect(parsedJson.site.Description).toBe("Site identifier"); // Added standard
      expect(parsedJson.gm_vol.Description).toBeDefined(); // Added standard
    });

    it("preserves root-level site for BIDS-direct when correction disabled", async () => {
      vi.mocked(exists).mockImplementation(async (path) => {
        const p = path.toString();
        if (p.endsWith("/participants.tsv") && !p.includes("derivatives")) return true;
        if (p.endsWith("ExploreASL")) return false;
        return false;
      });

      vi.mocked(readTextFile).mockImplementation(async (path) => {
        if (
          path.toString().endsWith("/participants.tsv") &&
          !path.toString().includes("derivatives")
        ) {
          return "participant_id\tsite\nsub-001Philips\tCenterA\n";
        }
        return "";
      });

      await ensureParticipantsFiles(
        "/test/project",
        config,
        mappingState,
        availableSubjects,
        false,
        "bids",
      );

      expect(writeTextFile).toHaveBeenCalledWith(
        "/test/project/derivatives/ExploreASL/participants.tsv",
        expect.stringContaining("CenterA"),
      );
    });

    it("strips site column from TSV and JSON when enabled is false and files exist", async () => {
      const existingTsv =
        "participant_id\tsession\tsite\tGM_vol\tWM_vol\n" +
        "sub-002Siemens_02\tASL_1\tGlobal_Defaults\t0.67894\t0.5418\n" +
        "sub-001Philips_01\tASL_1\tPhilips_Override\t0.63988\t0.48649\n";

      const existingJson = JSON.stringify({
        participant_id: { Description: "custom id desc" },
        site: { Description: "Site identifier" },
        custom_column: { Description: "a custom measurement" },
      });

      vi.mocked(exists).mockImplementation(async (path) => {
        if (path.toString().endsWith("participants.tsv")) return true;
        if (path.toString().endsWith("participants.json")) return true;
        return false;
      });

      vi.mocked(readTextFile).mockImplementation(async (path) => {
        if (path.toString().endsWith("participants.tsv")) return existingTsv;
        if (path.toString().endsWith("participants.json")) return existingJson;
        return "";
      });

      await ensureParticipantsFiles(
        "/test/project",
        config,
        mappingState,
        availableSubjects,
        false,
      );

      // Verify site was stripped from TSV
      expect(writeTextFile).toHaveBeenCalledWith(
        "/test/project/derivatives/ExploreASL/participants.tsv",
        "participant_id\tsession\tGM_vol\tWM_vol\n" +
          "sub-002Siemens_02\tASL_1\t0.67894\t0.5418\n" +
          "sub-001Philips_01\tASL_1\t0.63988\t0.48649\n",
      );

      // Verify site was deleted from JSON
      const writtenJsonCall = vi
        .mocked(writeTextFile)
        .mock.calls.find((call) => call[0].toString().endsWith("participants.json"));
      expect(writtenJsonCall).toBeDefined();
      const parsedJson = JSON.parse(writtenJsonCall![1] as string);
      expect(parsedJson.participant_id.Description).toBe("custom id desc");
      expect(parsedJson.custom_column.Description).toBe("a custom measurement");
      expect(parsedJson.site).toBeUndefined();
    });

    // --- Phase 8.3: site-precedence tests ---

    it("BIDS-direct + correction enabled + root site present: preserves user site, fills group label for unmatched", async () => {
      // Root participants.tsv has site for sub-001Philips only
      // sub-002Siemens has no root site → should get group label fallback
      vi.mocked(exists).mockImplementation(async (path) => {
        const p = path.toString();
        if (p.endsWith("/participants.tsv") && !p.includes("derivatives")) return true;
        if (p.endsWith("ExploreASL")) return false;
        return false;
      });

      vi.mocked(readTextFile).mockImplementation(async (path) => {
        if (
          path.toString().endsWith("/participants.tsv") &&
          !path.toString().includes("derivatives")
        ) {
          return "participant_id\tsite\nsub-001Philips\tCenterA\nsub-002Siemens\tCenterB\n";
        }
        return "";
      });

      await ensureParticipantsFiles(
        "/test/project",
        config,
        mappingState,
        availableSubjects,
        true,
        "bids",
      );

      // Both should get root site values preserved (not overwritten by group labels)
      expect(writeTextFile).toHaveBeenCalledWith(
        "/test/project/derivatives/ExploreASL/participants.tsv",
        expect.stringContaining("CenterA"),
      );
      expect(writeTextFile).toHaveBeenCalledWith(
        "/test/project/derivatives/ExploreASL/participants.tsv",
        expect.stringContaining("CenterB"),
      );
      // Should NOT contain group label values for these subjects
      const tsvCall = vi
        .mocked(writeTextFile)
        .mock.calls.find((c) => c[0].toString().endsWith("participants.tsv"));
      expect(tsvCall).toBeDefined();
      const tsvContent = tsvCall![1] as string;
      // CenterA and CenterB are the root values — group labels "Philips_Override" / "Global_Defaults" should NOT appear
      expect(tsvContent).not.toContain("Philips_Override");
      expect(tsvContent).not.toContain("Global_Defaults");
    });

    it("BIDS-direct + correction disabled + root site present: keeps site column in derivatives", async () => {
      vi.mocked(exists).mockImplementation(async (path) => {
        const p = path.toString();
        if (p.endsWith("/participants.tsv") && !p.includes("derivatives")) return true;
        if (p.endsWith("ExploreASL")) return false;
        return false;
      });

      vi.mocked(readTextFile).mockImplementation(async (path) => {
        if (
          path.toString().endsWith("/participants.tsv") &&
          !path.toString().includes("derivatives")
        ) {
          return "participant_id\tsite\nsub-001Philips\tCenterA\n";
        }
        return "";
      });

      await ensureParticipantsFiles(
        "/test/project",
        config,
        mappingState,
        availableSubjects,
        false,
        "bids",
      );

      const tsvCall = vi
        .mocked(writeTextFile)
        .mock.calls.find((c) => c[0].toString().endsWith("participants.tsv"));
      expect(tsvCall).toBeDefined();
      const tsvContent = tsvCall![1] as string;
      // Site column should be present (not stripped)
      expect(tsvContent).toContain("site");
      expect(tsvContent).toContain("CenterA");
    });

    it("BIDS-direct + root participants.tsv without site column: behaves like DICOM (group labels when enabled)", async () => {
      vi.mocked(exists).mockImplementation(async (path) => {
        const p = path.toString();
        // Root TSV exists but has NO site column
        if (p.endsWith("/participants.tsv") && !p.includes("derivatives")) return true;
        if (p.endsWith("ExploreASL")) return false;
        return false;
      });

      vi.mocked(readTextFile).mockImplementation(async (path) => {
        if (
          path.toString().endsWith("/participants.tsv") &&
          !path.toString().includes("derivatives")
        ) {
          return "participant_id\tage\nsub-001Philips\t55\n";
        }
        return "";
      });

      await ensureParticipantsFiles(
        "/test/project",
        config,
        mappingState,
        availableSubjects,
        true,
        "bids",
      );

      const tsvCall = vi
        .mocked(writeTextFile)
        .mock.calls.find((c) => c[0].toString().endsWith("participants.tsv"));
      expect(tsvCall).toBeDefined();
      const tsvContent = tsvCall![1] as string;
      // No root site → group labels should be used as fallback
      expect(tsvContent).toContain("Philips_Override");
      expect(tsvContent).toContain("Global_Defaults");
    });

    it("Root lookup matching: participant_id sub-XX matches sessions sub-XX_1 and sub-XX_2", async () => {
      // Multi-session config: sub-001Philips with sessions 01 and 03
      const multiSessionConfig: ProcessConfig = {
        subjects: ["sub-001Philips_01", "sub-001Philips_03", "sub-002Siemens_02"],
        modules: ["structural", "asl"],
        selectedProfileId: "profile-1",
        workers: 4,
      };

      const multiSessionSubjects: SubjectInfo[] = [
        {
          subjectSession: "sub-001Philips_01",
          subject: "001Philips",
          session: "01",
          hasStructural: true,
          hasASL: true,
          aslRuns: ["1"],
        },
        {
          subjectSession: "sub-001Philips_03",
          subject: "001Philips",
          session: "03",
          hasStructural: true,
          hasASL: true,
          aslRuns: ["1"],
        },
        {
          subjectSession: "sub-002Siemens_02",
          subject: "002Siemens",
          session: "02",
          hasStructural: true,
          hasASL: true,
          aslRuns: ["1"],
        },
      ];

      const multiSessionMappingState = {
        subjectRows: [
          {
            id: "001Philips/01",
            subject: "001Philips",
            session: "01",
            groupId: "group-philips",
          },
          {
            id: "001Philips/03",
            subject: "001Philips",
            session: "03",
            groupId: "group-philips",
          },
          {
            id: "002Siemens/02",
            subject: "002Siemens",
            session: "02",
            groupId: "group-siemens",
          },
        ],
        metadataGroups: [
          { id: "group-philips", label: "Philips_Group", bidsParams: {} },
          { id: "group-siemens", label: "Siemens_Group", bidsParams: {} },
        ],
      };

      // Root TSV lists subjects at subject level (no _session suffix)
      vi.mocked(exists).mockImplementation(async (path) => {
        const p = path.toString();
        if (p.endsWith("/participants.tsv") && !p.includes("derivatives")) return true;
        if (p.endsWith("ExploreASL")) return false;
        return false;
      });

      vi.mocked(readTextFile).mockImplementation(async (path) => {
        if (
          path.toString().endsWith("/participants.tsv") &&
          !path.toString().includes("derivatives")
        ) {
          return "participant_id\tsite\nsub-001Philips\tCenterA\n";
        }
        return "";
      });

      await ensureParticipantsFiles(
        "/test/project",
        multiSessionConfig,
        multiSessionMappingState,
        multiSessionSubjects,
        true,
        "bids",
      );

      const tsvCall = vi
        .mocked(writeTextFile)
        .mock.calls.find((c) => c[0].toString().endsWith("participants.tsv"));
      expect(tsvCall).toBeDefined();
      const tsvContent = tsvCall![1] as string;
      const lines = tsvContent.split("\n").filter(Boolean);

      // sub-001Philips_01 and sub-001Philips_03 should both get CenterA
      const line01 = lines.find((l) => l.includes("sub-001Philips_01"));
      const line03 = lines.find((l) => l.includes("sub-001Philips_03"));
      expect(line01).toBeDefined();
      expect(line03).toBeDefined();
      expect(line01).toContain("CenterA");
      expect(line03).toContain("CenterA");

      // sub-002Siemens_02 has no root site → gets group label fallback
      const lineSiemens = lines.find((l) => l.includes("sub-002Siemens_02"));
      expect(lineSiemens).toBeDefined();
      expect(lineSiemens).toContain("Siemens_Group");
    });

    it("merges BIDS base rows (e.g., sub-001Philips) into legacy target rows (e.g., sub-001Philips_01) and removes the base rows", async () => {
      const existingTsv = "participant_id\tAge\tGender\n" + "sub-001Philips\t21\tF\n";

      vi.mocked(exists).mockImplementation(async (path) => {
        const p = path.toString();
        if (p.endsWith("participants.tsv")) return true;
        if (p.endsWith("ExploreASL")) return false;
        return false;
      });

      vi.mocked(readTextFile).mockImplementation(async (path) => {
        if (path.toString().endsWith("participants.tsv")) return existingTsv;
        return "";
      });

      await ensureParticipantsFiles(
        "/test/project",
        config,
        mappingState,
        availableSubjects,
        true,
        "bids",
      );

      const tsvCall = vi
        .mocked(writeTextFile)
        .mock.calls.find((c) => c[0].toString().endsWith("participants.tsv"));
      expect(tsvCall).toBeDefined();
      const tsvContent = tsvCall![1] as string;
      const lines = tsvContent.split("\n").filter(Boolean);

      // Should contain the headers including Age and Gender
      expect(lines[0]).toBe("participant_id\tsession\tsite\tAge\tGender");

      // Should have merged sub-001Philips demographics to sub-001Philips_01 (since it was mapped to session 01 in availableSubjects)
      const line01_1 = lines.find((l) => l.startsWith("sub-001Philips_01\t"));
      expect(line01_1).toBeDefined();
      expect(line01_1).toBe("sub-001Philips_01\tASL_1\tPhilips_Override\t21\tF");

      // Should NOT contain the base sub-001Philips row anymore
      const lineBase = lines.find((l) => l.startsWith("sub-001Philips\t"));
      expect(lineBase).toBeUndefined();
    });

    it("BIDS-direct + correction disabled + root participants.tsv without site: does not generate or modify derivatives participants.tsv", async () => {
      vi.mocked(exists).mockImplementation(async (path) => {
        const p = path.toString();
        // Root TSV exists, derivatives does not
        if (p.endsWith("/participants.tsv") && !p.includes("derivatives")) return true;
        if (p.endsWith("ExploreASL")) return false;
        return false;
      });

      vi.mocked(readTextFile).mockImplementation(async (path) => {
        if (
          path.toString().endsWith("/participants.tsv") &&
          !path.toString().includes("derivatives")
        ) {
          return "participant_id\tage\nsub-001Philips\t21\n";
        }
        return "";
      });

      await ensureParticipantsFiles(
        "/test/project",
        config,
        mappingState,
        availableSubjects,
        false,
        "bids",
      );

      const tsvCall = vi
        .mocked(writeTextFile)
        .mock.calls.find((c) => c[0].toString().endsWith("participants.tsv"));
      expect(tsvCall).toBeUndefined();
    });
  });
});

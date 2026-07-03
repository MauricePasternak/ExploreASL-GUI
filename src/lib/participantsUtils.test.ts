import { beforeEach, describe, expect, it, vi } from "vitest";
import { exists, readTextFile, writeTextFile, mkdir } from "@tauri-apps/plugin-fs";
import { parseParticipantId, ensureParticipantsFiles } from "./participantsUtils";
import type { ProcessConfig, SubjectInfo } from "../schemas/processingSchemas";

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
      expect(parseParticipantId("sub-C9ORF007Philips_01")).toEqual({
        subject: "C9ORF007Philips",
        session: "01",
      });
    });

    it("parses participant ID without sub- prefix", () => {
      expect(parseParticipantId("C9ORF059Siemens_12")).toEqual({
        subject: "C9ORF059Siemens",
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
      expect(parseParticipantId("sub-C9ORF007")).toEqual({
        subject: "C9ORF007",
        session: "01",
      });
    });
  });

  describe("ensureParticipantsFiles", () => {
    const config: ProcessConfig = {
      subjects: ["sub-C9ORF007Philips_01", "sub-C9ORF059Siemens_02"],
      modules: ["structural", "asl"],
      matlabPath: "/usr/bin/matlab",
      exploreAslPath: "/opt/ExploreASL",
      workers: 4,
    };

    const mappingState = {
      subjectRows: [
        {
          id: "C9ORF007Philips/01",
          subject: "C9ORF007Philips",
          session: "01",
          groupId: "group-philips",
        },
        {
          id: "C9ORF059Siemens/02",
          subject: "C9ORF059Siemens",
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
        subjectSession: "sub-C9ORF007Philips_01",
        subject: "C9ORF007Philips",
        session: "01",
        hasStructural: true,
        hasASL: true,
        aslRuns: ["1", "2"],
      },
      {
        subjectSession: "sub-C9ORF059Siemens_02",
        subject: "C9ORF059Siemens",
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
          "sub-C9ORF007Philips_01\tASL_1\tPhilips_Override\n" +
          "sub-C9ORF007Philips_01\tASL_2\tPhilips_Override\n" +
          "sub-C9ORF059Siemens_02\tASL_1\tGlobal_Defaults\n",
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
        "sub-C9ORF059Siemens_02\tASL_1\t0.67894\t0.5418\n" +
        "sub-C9ORF007Philips_01\tASL_1\t0.63988\t0.48649\n";

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
          "sub-C9ORF007Philips_01\tASL_1\tPhilips_Override\t0.63988\t0.48649\n" +
          "sub-C9ORF007Philips_01\tASL_2\tPhilips_Override\t\t\n" +
          "sub-C9ORF059Siemens_02\tASL_1\tGlobal_Defaults\t0.67894\t0.5418\n",
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

    it("strips site column from TSV and JSON when enabled is false and files exist", async () => {
      const existingTsv =
        "participant_id\tsession\tsite\tGM_vol\tWM_vol\n" +
        "sub-C9ORF059Siemens_02\tASL_1\tGlobal_Defaults\t0.67894\t0.5418\n" +
        "sub-C9ORF007Philips_01\tASL_1\tPhilips_Override\t0.63988\t0.48649\n";

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
          "sub-C9ORF059Siemens_02\tASL_1\t0.67894\t0.5418\n" +
          "sub-C9ORF007Philips_01\tASL_1\t0.63988\t0.48649\n",
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
  });
});

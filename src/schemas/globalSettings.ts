import { z } from "zod";
import { ExecutionProfileSchema } from "./executionProfile";

const TokenSubDelimiterSchema = z.string().trim().min(1).max(1);

export const ImportSettingsSchema = z.object({
  preserveStagingDir: z.boolean().default(false),
});

export const GlobalSettingsSchema = z.object({
  executionProfiles: z.array(ExecutionProfileSchema).default([]),
  theme: z.enum(["light", "dark"]).default("light"),
  recentProjects: z.array(z.string()).default([]),
  tokenSubDelimiters: z
    .array(TokenSubDelimiterSchema)
    .min(1, "At least one tokenizer delimiter is required")
    .refine((delimiters) => new Set(delimiters).size === delimiters.length, {
      message: "Tokenizer delimiters must be unique",
    })
    .default(["_", "-"]),
  import: ImportSettingsSchema.default({ preserveStagingDir: false }),
});

export type ImportSettings = z.infer<typeof ImportSettingsSchema>;
export type GlobalSettings = z.infer<typeof GlobalSettingsSchema>;

export const DEFAULT_SETTINGS: GlobalSettings = {
  executionProfiles: [],
  theme: "light",
  recentProjects: [],
  tokenSubDelimiters: ["_", "-"],
  import: {
    preserveStagingDir: false,
  },
};

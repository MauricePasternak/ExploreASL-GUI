import { z } from "zod";
import { ExecutionProfileSchema } from "./executionProfile";

const TokenSubDelimiterSchema = z.string().trim().min(1).max(1);

export const ImportSettingsSchema = z.object({
  preserveStagingDir: z.boolean().default(false),
});

export const RecentProjectSchema = z.object({
  path: z.string().trim().min(1),
  projectId: z.string().trim().min(1).optional(),
});

const RecentProjectInputSchema = z.union([
  z
    .string()
    .trim()
    .min(1)
    .transform((path) => ({ path })),
  RecentProjectSchema,
]);

export const RecentProjectsSchema = z.array(z.unknown()).transform((entries) => {
  const seen = new Set<string>();
  const normalized: Array<z.infer<typeof RecentProjectSchema>> = [];
  for (const entry of entries) {
    const parsed = RecentProjectInputSchema.safeParse(entry);
    if (!parsed.success || seen.has(parsed.data.path)) continue;
    seen.add(parsed.data.path);
    normalized.push(parsed.data);
  }
  return normalized.slice(0, 20);
});

export const GlobalSettingsSchema = z.object({
  executionProfiles: z.array(ExecutionProfileSchema).default([]),
  theme: z.enum(["light", "dark"]).default("light"),
  recentProjects: RecentProjectsSchema.default([]),
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
export type RecentProject = z.infer<typeof RecentProjectSchema>;
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

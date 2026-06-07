import { z } from "zod";

export const MatlabInstallationSchema = z.object({
  id: z.string(),
  label: z.string().min(1, "Label is required"),
  path: z.string().min(1, "Path is required"),
});

const TokenSubDelimiterSchema = z.string().trim().min(1).max(1);

export const GlobalSettingsSchema = z.object({
  matlabInstallations: z.array(MatlabInstallationSchema).default([]),
  exploreAslPath: z.string().default(""),
  theme: z.enum(["light", "dark"]).default("light"),
  recentProjects: z.array(z.string()).default([]),
  tokenSubDelimiters: z
    .array(TokenSubDelimiterSchema)
    .min(1, "At least one tokenizer delimiter is required")
    .refine((delimiters) => new Set(delimiters).size === delimiters.length, {
      message: "Tokenizer delimiters must be unique",
    })
    .default(["_", "-"]),
});

export type MatlabInstallation = z.infer<typeof MatlabInstallationSchema>;
export type GlobalSettings = z.infer<typeof GlobalSettingsSchema>;

export const DEFAULT_SETTINGS: GlobalSettings = {
  matlabInstallations: [],
  exploreAslPath: "",
  theme: "light",
  recentProjects: [],
  tokenSubDelimiters: ["_", "-"],
};



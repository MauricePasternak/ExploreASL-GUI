import { z } from "zod";

export const ExecutionProfileBaseSchema = z.object({
  id: z.uuid(),
  label: z.string().min(1, "Label is required"),
  exploreAslVersion: z.string().optional(),
});

export const MatlabProfileSchema = ExecutionProfileBaseSchema.extend({
  type: z.literal("matlab"),
  matlabPath: z.string().min(1, "MATLAB path is required"),
  exploreAslPath: z.string().min(1, "ExploreASL path is required"),
});

export const ApptainerProfileSchema = ExecutionProfileBaseSchema.extend({
  type: z.literal("apptainer"),
  sifPath: z.string().min(1, "SIF path is required"),
  apptainerPath: z.string().min(1, "Apptainer executable path is required").default("apptainer"),
});

export const ExecutionProfileSchema = z.discriminatedUnion("type", [
  MatlabProfileSchema,
  ApptainerProfileSchema,
]);

export type ExecutionProfile = z.infer<typeof ExecutionProfileSchema>;
export type MatlabProfile = z.infer<typeof MatlabProfileSchema>;
export type ApptainerProfile = z.infer<typeof ApptainerProfileSchema>;

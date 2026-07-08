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

export const ExecutionProfileSchema = z.discriminatedUnion("type", [MatlabProfileSchema]);

export type ExecutionProfile = z.infer<typeof ExecutionProfileSchema>;
export type MatlabProfile = z.infer<typeof MatlabProfileSchema>;

import { z } from "zod";

import { BidsAslMetadataSchema } from "../../schemas/importSchemas";

export const MetadataGroupFormSchema = z.object({
  label: z.string().trim().min(1, "Label is required"),
  bidsParams: BidsAslMetadataSchema,
});

export type MetadataGroupFormValues = z.infer<typeof MetadataGroupFormSchema>;

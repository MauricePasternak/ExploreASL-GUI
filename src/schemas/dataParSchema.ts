import { z } from "zod";

export const M0Schema = z.union([
  z.enum(["separate_scan", "UseControlAsM0", "Absent"]),
  z.number(),
]);

export const ApplyQuantificationSchema = z.array(z.number().min(0).max(1)).length(6);

export const PVCNativeSpaceKernelSchema = z.tuple([z.number(), z.number(), z.number()]);

export const M0SectionSchema = z.object({
  M0: M0Schema.optional(),
  BackgroundSuppressionNumberPulses: z.number().optional(),
  BackgroundSuppressionPulseTime: z.union([z.number(), z.array(z.number())]).optional(),
  M0_GMScaleFactor: z.number().optional(),
  bRegisterM02ASL: z.union([z.literal(0), z.literal(1)]).optional(),
  M0_conventionalProcessing: z.union([z.literal(0), z.literal(1)]).optional(),
  RepetitionTimePreparationM0: z.union([z.number(), z.array(z.number())]).optional(),
});

export const QuantificationSectionSchema = z.object({
  nCompartments: z.number().optional(),
  Lambda: z.number().optional(),
  T2art: z.number().optional(),
  T1blood: z.number().optional(),
  T1GM: z.number().optional(),
  T1WM: z.number().optional(),
  T2GM: z.number().optional(),
  T2WM: z.number().optional(),
  T2tissueMultiTE: z.number().optional(),
  bUseExternalQuantification: z.boolean().optional(),
  ExternalQuantificationType: z.string().optional(),
  ExternalQuantificationSmoothGaussianMM: z
    .tuple([z.number().int(), z.number().int(), z.number().int()])
    .optional(),
  bMaskingExternal: z.boolean().optional(),
  bSpatialBASIL: z.boolean().optional(),
  bInferT1BASIL: z.boolean().optional(),
  bInferATTBASIL: z.boolean().optional(),
  ExchBASIL: z.string().optional(),
  DispBASIL: z.string().optional(),
  ATTSDBASIL: z.number().optional(),
  bCleanUpExternal: z.boolean().optional(),
});

export const GeneralSettingsSectionSchema = z.object({
  Quality: z.union([z.literal(0), z.literal(1)]).optional(),
  DELETETEMP: z.union([z.literal(0), z.literal(1)]).optional(),
  SkipIfNoFlair: z.union([z.literal(0), z.literal(1)]).optional(),
  SkipIfNoASL: z.union([z.literal(0), z.literal(1)]).optional(),
  SkipIfNoM0: z.union([z.literal(0), z.literal(1)]).optional(),
  enableMetadataGroupingCorrection: z.boolean().optional(),
});

export const ASLProcessingSectionSchema = z.object({
  motionCorrection: z.union([z.literal(0), z.literal(1)]).optional(),
  bTopUp: z.boolean().optional(),
  bPVCNativeSpace: z.union([z.literal(0), z.literal(1)]).optional(),
  bPVCGaussianMM: z.union([z.literal(0), z.literal(1)]).optional(),
  PVCNativeSpaceKernel: PVCNativeSpaceKernelSchema.optional(),
  SaveCBF4D: z.boolean().optional(),
  SpikeRemovalThreshold: z.number().optional(),
  SpikeRemovalAbsoluteThreshold: z.number().optional(),
  bRegistrationContrast: z.number().optional(),
  bAffineRegistration: z.number().optional(),
  bDCTRegistration: z.number().optional(),
  bUseMNIasDummyStructural: z.union([z.literal(0), z.literal(1)]).optional(),
  bHct2BloodT1: z.number().optional(),
  ApplyQuantification: ApplyQuantificationSchema.optional(),
});

export const AtlasesSectionSchema = z.object({
  Atlases: z.array(z.string()).optional(),
  TissueMasking: z.array(z.string()).optional(),
  TissueThreshold: z.array(z.number().min(0).max(1)).optional(),
  bMasking: z
    .tuple([
      z.union([z.literal(0), z.literal(1)]),
      z.union([z.literal(0), z.literal(1)]),
      z.union([z.literal(0), z.literal(1)]),
      z.union([z.literal(0), z.literal(1)]),
    ])
    .optional(),
  MinimalROIVolume: z.number().optional(),
  bWMH: z.boolean().optional(),
  DataTypes: z.array(z.string()).optional(),
});

export const StructuralSectionSchema = z.object({
  bRunLongReg: z.union([z.literal(0), z.literal(1)]).optional(),
  bRunDARTEL: z.union([z.literal(0), z.literal(1)]).optional(),
  WMHsegmAlg: z.string().optional(),
  bSegmentSPM12: z.union([z.literal(0), z.literal(1)]).optional(),
  bHammersCAT12: z.union([z.literal(0), z.literal(1)]).optional(),
  bFixResolution: z.boolean().optional(),
  bLesionFilling: z.boolean().optional(),
  bAutoACPC: z.boolean().optional(),
});

export const EnvironmentSectionSchema = z.object({
  bAutomaticallyDetectFSL: z.boolean().optional(),
  bAutomaticallyDetectVABY: z.boolean().optional(),
});

export const DataParSchema = z
  .object({})
  .extend(M0SectionSchema.shape)
  .extend(QuantificationSectionSchema.shape)
  .extend(GeneralSettingsSectionSchema.shape)
  .extend(ASLProcessingSectionSchema.shape)
  .extend(AtlasesSectionSchema.shape)
  .extend(StructuralSectionSchema.shape)
  .extend(EnvironmentSectionSchema.shape)
  .loose();

export type DataParState = z.infer<typeof DataParSchema>;

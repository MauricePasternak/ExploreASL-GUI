import { z } from "zod";

export const M0Schema = z.union([
  z.enum(["separate_scan", "UseControlAsM0", "Absent"]),
  z.number(),
]);

export const ApplyQuantificationSchema = z
  .array(z.number().min(0).max(1))
  .length(6);

export const PVCNativeSpaceKernelSchema = z.tuple([
  z.number(),
  z.number(),
  z.number(),
]);

export const M0SectionSchema = z.object({
  M0: M0Schema.optional(),
  BackgroundSuppressionNumberPulses: z.number().optional(),
  BackgroundSuppressionPulseTime: z.number().optional(),
  M0_GMScaleFactor: z.number().optional(),
  bRegisterM02ASL: z.boolean().optional(),
  M0_conventionalProcessing: z.boolean().optional(),
  RepetitionTimePreparationM0: z.number().optional(),
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
    .tuple([z.number(), z.number(), z.number()])
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
  Quality: z.number().optional(),
  DELETETEMP: z.boolean().optional(),
  SkipIfNoFlair: z.boolean().optional(),
  SkipIfNoASL: z.boolean().optional(),
  SkipIfNoM0: z.boolean().optional(),
  stopAfterErrors: z.number().optional(),
});

export const ASLProcessingSectionSchema = z.object({
  motionCorrection: z.boolean().optional(),
  bTopUp: z.boolean().optional(),
  bPVCNativeSpace: z.boolean().optional(),
  bPVCGaussianMM: z.boolean().optional(),
  PVCNativeSpaceKernel: PVCNativeSpaceKernelSchema.optional(),
  SaveCBF4D: z.boolean().optional(),
  SpikeRemovalThreshold: z.number().optional(),
  SpikeRemovalAbsoluteThreshold: z.number().optional(),
  bRegistrationContrast: z.number().optional(),
  bAffineRegistration: z.number().optional(),
  bDCTRegistration: z.number().optional(),
  bUseMNIasDummyStructural: z.boolean().optional(),
  bHct2BloodT1: z.number().optional(),
  ApplyQuantification: ApplyQuantificationSchema.optional(),
});

export const AtlasesSectionSchema = z.object({
  Atlases: z.array(z.string()).optional(),
  TissueMasking: z.array(z.string()).optional(),
  TissueThreshold: z.array(z.number()).optional(),
  bMasking: z.array(z.union([z.boolean(), z.number()])).optional(),
  MinimalROIVolume: z.number().optional(),
  bWMH: z.boolean().optional(),
  DataTypes: z.array(z.string()).optional(),
});

export const StructuralSectionSchema = z.object({
  bRunLongReg: z.boolean().optional(),
  bRunDARTEL: z.boolean().optional(),
  WMHsegmAlg: z.string().optional(),
  bSegmentSPM12: z.boolean().optional(),
  bHammersCAT12: z.boolean().optional(),
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
  .merge(M0SectionSchema)
  .merge(QuantificationSectionSchema)
  .merge(GeneralSettingsSectionSchema)
  .merge(ASLProcessingSectionSchema)
  .merge(AtlasesSectionSchema)
  .merge(StructuralSectionSchema)
  .merge(EnvironmentSectionSchema)
  .passthrough();

export type DataParState = z.infer<typeof DataParSchema>;

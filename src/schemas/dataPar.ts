import { z } from "zod";

export const DataParStateSchema = z
  .object({
    Lambda: z.number().optional(),
    T2art: z.number().optional(),
    T1blood: z.number().optional(),
    T1GM: z.number().optional(),
    T1WM: z.number().optional(),
    T2GM: z.number().optional(),
    T2WM: z.number().optional(),
    T2tissueMultiTE: z.number().optional(),
    nCompartments: z.union([z.literal(1), z.literal(2)]).optional(),

    M0_conventionalProcessing: z.union([z.literal(0), z.literal(1)]).optional(),
    M0_GMScaleFactor: z.number().optional(),
    M0PositionInASL4D: z.array(z.number()).optional(),
    DummyScanPositionInASL4D: z.array(z.number()).optional(),
    RepetitionTimePreparationM0: z.array(z.number()).optional(),

    SaveCBF4D: z.boolean().optional(),
    motionCorrection: z.union([z.literal(0), z.literal(1)]).optional(),
    SpikeRemovalThreshold: z.number().optional(),
    SpikeRemovalAbsoluteThreshold: z.number().optional(),
    bRegistrationContrast: z
      .union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)])
      .optional(),
    bAffineRegistration: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional(),
    bDCTRegistration: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional(),
    bRegisterM02ASL: z.union([z.literal(0), z.literal(1)]).optional(),
    bUseMNIasDummyStructural: z.union([z.literal(0), z.literal(1)]).optional(),
    bPVCNativeSpace: z.union([z.literal(0), z.literal(1)]).optional(),
    PVCNativeSpaceKernel: z.array(z.number()).optional(),
    bPVCGaussianMM: z.union([z.literal(0), z.literal(1)]).optional(),
    bMakeNIfTI4DICOM: z.boolean().optional(),
    ApplyQuantification: z.array(z.boolean()).optional(),
    bQuantifyMultiTE: z.boolean().optional(),
    bHct2BloodT1: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional(),
    bUseExternalQuantification: z.boolean().optional(),
    ExternalQuantificationType: z.enum(["BASIL", "FABBER", "VABY"]).optional(),

    Quality: z.union([z.literal(0), z.literal(1)]).optional(),
    DELETETEMP: z.union([z.literal(0), z.literal(1)]).optional(),
    SkipIfNoFlair: z.union([z.literal(0), z.literal(1)]).optional(),
    SkipIfNoASL: z.union([z.literal(0), z.literal(1)]).optional(),
    SkipIfNoM0: z.union([z.literal(0), z.literal(1)]).optional(),
    bLesionFilling: z.boolean().optional(),
    bAutoACPC: z.boolean().optional(),

    bMasking: z.array(z.boolean()).optional(),
    MinimalROIVolume: z.number().optional(),
    bWMH: z.boolean().optional(),
    DataTypes: z.array(z.string()).optional(),
    Atlases: z.array(z.string()).optional(),
    TissueMasking: z.array(z.string()).optional(),
    TissueThreshold: z.array(z.number().min(0).max(1)).optional(),
    LesionROIThreshold: z.number().optional(),

    bRunLongReg: z.union([z.literal(0), z.literal(1)]).optional(),
    bRunDARTEL: z.union([z.literal(0), z.literal(1)]).optional(),
    WMHsegmAlg: z.enum(["LGA", "LPA"]).optional(),
    bSegmentSPM12: z.union([z.literal(0), z.literal(1)]).optional(),
    bHammersCAT12: z.union([z.literal(0), z.literal(1)]).optional(),
    bFixResolution: z.boolean().optional(),
    bNativeSpaceAnalysis: z.boolean().optional(),

    bAutomaticallyDetectFSL: z.boolean().optional(),
    bAutomaticallyDetectVABY: z.boolean().optional(),
  })
  .passthrough();

export type DataParState = z.infer<typeof DataParStateSchema>;

export const DEFAULT_DATA_PAR: DataParState = {};

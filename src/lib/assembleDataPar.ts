import type { DataParState } from "../schemas/dataParSchema";

export interface DataParJson {
  x: {
    opts?: {
      subjectFolder?: string;
    };
    Q?: Record<string, unknown>;
    modules?: {
      bRunLongReg?: DataParState["bRunLongReg"];
      bRunDARTEL?: DataParState["bRunDARTEL"];
      asl?: Record<string, unknown>;
      structural?: Record<string, unknown>;
    };
    settings?: Record<string, unknown>;
    S?: Record<string, unknown>;
    external?: Record<string, unknown>;
    dataset?: {
      subjectRegexp?: string;
      ForceInclusionList?: string[];
    };
    WMHsegmAlg?: string;
  };
}

function isEmpty(obj: Record<string, unknown> | undefined): boolean {
  if (obj === undefined) return true;
  return Object.keys(obj).length === 0;
}

function buildSection(state: DataParState, keys: string[]): Record<string, unknown> | undefined {
  const result: Record<string, unknown> = {};
  let hasValues = false;

  for (const key of keys) {
    const value = (state as Record<string, unknown>)[key];
    if (value !== undefined) {
      result[key] = value;
      hasValues = true;
    }
  }

  return hasValues ? result : undefined;
}

export function assembleDataPar(state: DataParState): DataParJson {
  const qKeys = [
    "M0",
    "Lambda",
    "T2art",
    "T1blood",
    "T1GM",
    "T1WM",
    "T2GM",
    "T2WM",
    "T2tissueMultiTE",
    "nCompartments",
    "BackgroundSuppressionNumberPulses",
    "BackgroundSuppressionPulseTime",
    "RepetitionTimePreparationM0",
  ];

  const aslKeys = [
    "bTopUp",
    "motionCorrection",
    "bPVCNativeSpace",
    "bPVCGaussianMM",
    "PVCNativeSpaceKernel",
    "SaveCBF4D",
    "SpikeRemovalThreshold",
    "SpikeRemovalAbsoluteThreshold",
    "bRegistrationContrast",
    "bAffineRegistration",
    "bDCTRegistration",
    "bUseMNIasDummyStructural",
    "bHct2BloodT1",
    "ApplyQuantification",
    "M0_GMScaleFactor",
    "bRegisterM02ASL",
    "M0_conventionalProcessing",
    "bUseExternalQuantification",
    "ExternalQuantificationType",
    "ExternalQuantificationSmoothGaussianMM",
    "bMaskingExternal",
    "bSpatialBASIL",
    "bInferT1BASIL",
    "bInferATTBASIL",
    "ExchBASIL",
    "DispBASIL",
    "ATTSDBASIL",
    "bCleanUpExternal",
  ];

  const structuralKeys = ["bSegmentSPM12", "bHammersCAT12", "bFixResolution"];

  const settingsKeys = [
    "Quality",
    "DELETETEMP",
    "SkipIfNoFlair",
    "SkipIfNoASL",
    "SkipIfNoM0",
    "bLesionFilling",
    "bAutoACPC",
  ];

  const sKeys = [
    "Atlases",
    "TissueMasking",
    "TissueThreshold",
    "bMasking",
    "MinimalROIVolume",
    "bWMH",
    "DataTypes",
  ];

  const externalKeys = ["bAutomaticallyDetectFSL", "bAutomaticallyDetectVABY"];

  const q = buildSection(state, qKeys);
  const asl = buildSection(state, aslKeys);
  const structural = buildSection(state, structuralKeys);
  const settings = buildSection(state, settingsKeys);
  const s = buildSection(state, sKeys);
  const external = buildSection(state, externalKeys);
  const moduleOptions = buildSection(state, ["bRunLongReg", "bRunDARTEL"]);

  const modules =
    !isEmpty(asl) || !isEmpty(structural) || !isEmpty(moduleOptions)
      ? {
          ...moduleOptions,
          ...(!isEmpty(asl) && { asl }),
          ...(!isEmpty(structural) && { structural }),
        }
      : undefined;

  const x: DataParJson["x"] = {
    ...(!isEmpty(q) && { Q: q }),
    ...(modules && { modules }),
    ...(!isEmpty(settings) && { settings }),
    ...(!isEmpty(s) && { S: s }),
    ...(!isEmpty(external) && { external }),
  };

  if (state.WMHsegmAlg !== undefined) {
    x.WMHsegmAlg = state.WMHsegmAlg;
  }

  return { x };
}

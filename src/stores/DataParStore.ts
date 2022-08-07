import { atom } from "jotai";
import { DataParValuesType } from "../common/types/ExploreASLDataParTypes";
import { DataParTabOption } from "../common/types/DataParSchemaTypes";

export const atomDataParCurrentTab = atom<DataParTabOption>("StudyParameters");

export const defaultDataParValues: DataParValuesType = {
  x: {
    // Dataset and Study Parameters
    dataset: {
      name: "",
      subjectRegexp: "",
      exclusion: [],
      // SESSIONS: [],
    },

    // External Parameters
    external: { bAutomaticallyDetectFSL: false, FSLPath: "" },

    // GUI necessary Parameters
    GUI: {
      StudyRootPath: "",
      SUBJECTS: [],
      EASLPath: "",
      EASLType: "Github",
      MATLABRuntimePath: "",
    },

    modules: {
      asl: {
        // ASL Module - M0 Processing Parameters
        M0_conventionalProcessing: 0,
        M0_GMScaleFactor: 1,

        // ASL Module - ASL Processing Parameters
        motionCorrection: 1,
        SpikeRemovalThreshold: 0.01,
        bRegistrationContrast: 2,
        bAffineRegistration: 0,
        bDCTRegistration: 0,
        bRegisterM02ASL: 0,
        bUseMNIasDummyStructural: 0,
        bPVCNativeSpace: 0,
        PVCNativeSpaceKernel: [5, 5, 1],
        bPVCGaussianMM: 0,
        MakeNIfTI4DICOM: false,
      },

      // Structural Module Processing Parameters
      bRunLongReg: 0,
      bRunDARTEL: 0,
      structural: {
        bSegmentSPM12: 0,
        bHammersCAT12: 0,
        bFixResolution: false,
      },
    },

    Q: {
      // Sequence Parameters
      Vendor: "Siemens",
      Sequence: "3D_GRASE",
      readoutDim: "3D",
      LabelingType: "CASL",
      M0: "UseControlAsM0",
      BackgroundSuppressionNumberPulses: 0,
      BackgroundSuppressionPulseTime: [],
      Initial_PLD: 1800,
      LabelingDuration: 800,
      SliceReadoutTime: 47,

      // ASL Quantification Parameters
      bUseBasilQuantification: false,
      Lambda: 0.9,
      T2art: 50,
      BloodT1: 1650,
      TissueT1: 1240,
      nCompartments: 1,
      ApplyQuantification: [1, 1, 1, 1, 1],
      SaveCBF4D: false,
    },

    // General Processing Parameters
    settings: {
      Quality: 1,
      DELETETEMP: 1,
      SkipIfNoFlair: 0,
      SkipIfNoASL: 0,
      SkipIfNoM0: 0,
    },

    // Population & Masking Parameters
    S: {
      bMasking: [1, 1, 1, 1],
      Atlases: ["TotalGM", "DeepWM"],
    },
  },
};

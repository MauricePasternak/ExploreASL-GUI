import { atom } from "jotai";
import { cloneDeep as lodashCloneDeep } from "lodash";
import { atomPreferredExploreASLPath, atomPreferredMATLABRuntimePath } from "./GlobalSettingsStore";
export const atomImportModuleCurrentProcPID = atom(-1);
export const atomImportModuleCurrentProcStatus = atom("Standby");
export const ImportModuleChannelName = "ImportModule";
/**
 * The default single import context to clone from when creating new contexts.
 * It is based on a GE PCASL sequence with no background suppression.
 */
export const ImportSingleContextDefault = {
    // GUI Meta
    // IsGlobal: true, // Terrible hack to make the validation work
    Paths: [],
    SubjectRegExp: "",
    VisitRegExp: "",
    SessionRegExp: "",
    // ASL Context
    ASLSeriesPattern: "deltam",
    NVolumes: 2,
    M0PositionInASL: [],
    DummyPositionInASL: [],
    // M0 Info
    M0Type: "Separate",
    // ASL Sequence Info
    // Main Fields
    Manufacturer: "GE",
    PulseSequenceType: "3D_spiral",
    MagneticFieldStrength: 3,
    ArterialSpinLabelingType: "PCASL",
    PostLabelingDelay: 1.525,
    LabelingDuration: 1.45,
    // Background Suppression Info
    BackgroundSuppressionNumberPulses: 0,
    BackgroundSuppressionPulseTime: [],
};
export const ImportSingleContextDefaultValueMapping = {
    // GUI Meta
    // IsGlobal: true, // Terrible hack to make the validation work
    Paths: [],
    SubjectRegExp: "",
    VisitRegExp: "",
    SessionRegExp: "",
    // ASL Context
    ASLSeriesPattern: "deltam",
    NVolumes: 2,
    M0PositionInASL: [],
    DummyPositionInASL: [],
    // M0 Info
    M0Type: "Separate",
    M0Estimate: 1,
    // ASL Sequence Info
    // Main Fields
    Manufacturer: "GE",
    PulseSequenceType: "3D_spiral",
    MagneticFieldStrength: 3,
    ArterialSpinLabelingType: "PCASL",
    PostLabelingDelay: 1.525,
    // 2D Specific Fields
    SliceReadoutTime: 0.03,
    // PCASL/CASL Specific
    LabelingDuration: 1.45,
    // PASL Specific
    BolusCutOffFlag: false,
    BolusCutOffTechnique: "",
    BolusCutOffDelayTime: 0,
    // Background Suppression Info
    BackgroundSuppressionNumberPulses: 0,
    BackgroundSuppressionPulseTime: [],
};
export const atomImportModuleFormDefaultValues = atom((get) => {
    const preferredExploreASLPath = get(atomPreferredExploreASLPath);
    const preferredMATLABRuntimePath = get(atomPreferredMATLABRuntimePath);
    return {
        EASLType: "Github",
        EASLPath: preferredExploreASLPath,
        MATLABRuntimePath: preferredMATLABRuntimePath,
        StudyRootPath: "",
        SourcedataStructure: ["Subject", "Scan"],
        MappingVisitAliases: {},
        MappingSessionAliases: {},
        MappingScanAliases: {},
        ImportContexts: [lodashCloneDeep(ImportSingleContextDefault)],
    };
});
//# sourceMappingURL=ImportPageStore.js.map
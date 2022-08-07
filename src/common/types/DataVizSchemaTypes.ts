export type LoadEASLDataFrameSchema = {
  StudyRootPath: string;
  Atlases: Array<
    "TotalGM" |
    "DeepWM" |
    "MNI_Structural" |
    "Hammers" |
    "HOcort_CONN" |
    "HOsub_CONN" |
    "Mindboggle_OASIS_DKT31_CMA"
  >;
  Statistic: "mean" | "median" | "CoV";
  PVC: "PVC0" | "PVC2";
  MetadataPath: string;
};

export type NivoGraphType = "Scatterplot" | "Swarmplot";

export type NivoPlotVariablesSchema = {
  YAxisVar: string;
  XAxisVar: string;
  GroupingVar?: string;
  HoverVariables?: string[];
};

export type ScatterplotSettings = {
  nodeSize: number;
  enableGridX: boolean;
  enableGridY: boolean;
};

export type MRISliceOrientation = "axial" | "coronal" | "sagittal";

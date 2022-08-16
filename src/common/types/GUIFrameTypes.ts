export type GUIPageNames = "Import" | "DataPar" | "ProcessStudies" | "About" | "DataVisualization" | "BIDSDatagrid";

export type DrawerItem = {
  label?: string;
  value: GUIPageNames;
  icon: React.ReactNode;
  children?: DrawerItem[];
};

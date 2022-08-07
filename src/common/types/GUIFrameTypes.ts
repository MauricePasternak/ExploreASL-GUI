export type GUIPageNames = "Import" | "DataPar" | "ProcessStudies" | "About" | "DataVisualization";

export type DrawerItem = {
  label?: string;
  value: GUIPageNames;
  icon: React.ReactNode;
  children?: DrawerItem[];
};

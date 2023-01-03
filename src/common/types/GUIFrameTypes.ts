export type GUIPageNames =
	| "Import"
	| "BIDSDatagrid"
	| "DataPar"
	| "ProcessStudies"
	| "DataVisualization"
	| "About"
	| "Settings";

export type DrawerItem = {
	label?: string;
	value: GUIPageNames;
	icon: React.ReactNode;
	children?: DrawerItem[];
};

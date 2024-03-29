import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import FunctionsIcon from "@mui/icons-material/Functions";
import InfoIcon from "@mui/icons-material/Info";
import PeopleIcon from "@mui/icons-material/People";
import SettingsIcon from "@mui/icons-material/Settings";
import TuneIcon from "@mui/icons-material/Tune";
import UndoIcon from "@mui/icons-material/Undo";
import Collapse from "@mui/material/Collapse";
import Drawer from "@mui/material/Drawer";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import { styled } from "@mui/material/styles";
import SvgIcon from "@mui/material/SvgIcon";
import Typography from "@mui/material/Typography";
import { useAtom, useSetAtom } from "jotai";
import React from "react";
import ProcessIcon from "../../assets/svg/ArrowsSpinSolid.svg";
import BIDSIcon from "../../assets/svg/BIDSIcon.svg";
import BrainSvg from "../../assets/svg/Brain.svg";
import DICOM2NIFTIIcon from "../../assets/svg/DICOM2NIFTI.svg";
import ExploreASLIcon from "../../assets/svg/ExploreASLIcon.svg";
import ScatterPlotIcon from "../../assets/svg/ScatterGraph.svg";
import { APPBARHEIGHTPIXELS } from "../../common/GLOBALS";
import ExpandMore from "../../components/ExpandMore";
import { atomDataParCurrentTab } from "../../stores/DataParStore";
import { atomCurrentGUIPage, atomDrawerIsOpen } from "../../stores/GUIFrameStore";
import { atomProcStudyCurrentTab } from "../../stores/ProcessStudiesStore";

type ApplicationDrawerProps = {
	drawerWidth?: number;
};

const LoweredTemporaryDrawer = styled(Drawer)<{ width: number; margintop: number }>(
	({ width, margintop = APPBARHEIGHTPIXELS }) => ({
		marginTop: `${margintop}px`,
		"& .MuiDrawer-paper": {
			width: `${width}px`,
			boxSizing: "border-box",
			marginTop: `${margintop}px`,
		},
		"& .MuiBackdrop-root": {
			marginTop: `${margintop}px`,
		},
	})
);

function ApplicationDrawer({ drawerWidth = 350 }: ApplicationDrawerProps) {
	const [open, setOpen] = useAtom(atomDrawerIsOpen);
	const setCurrentModule = useSetAtom(atomCurrentGUIPage);
	const [expandedDataPar, setExpandedDataPar] = React.useState(false);
	const setDataParTab = useSetAtom(atomDataParCurrentTab);
	const [expandedProcStudies, setExpandedProcStudies] = React.useState(false);
	const setProcStudiesTab = useSetAtom(atomProcStudyCurrentTab);

	return (
		<LoweredTemporaryDrawer
			width={drawerWidth}
			margintop={APPBARHEIGHTPIXELS}
			variant="temporary"
			anchor="left"
			open={open}
			onClose={() => setOpen(!open)}
		>
			<List>
				<ListItemButton
					divider
					onClick={() => {
						setCurrentModule("Import");
						setOpen(false);
					}}
				>
					<ListItemIcon>
						<SvgIcon component={DICOM2NIFTIIcon} inheritViewBox sx={{ fontSize: "3rem" }} />
					</ListItemIcon>
					<ListItemText>Import A Dataset</ListItemText>
				</ListItemButton>

				<ListItemButton
					divider
					onClick={() => {
						setCurrentModule("BIDSDatagrid");
						setOpen(false);
					}}
				>
					<ListItemIcon>
						<SvgIcon component={BIDSIcon} inheritViewBox sx={{ fontSize: "3rem" }} />
					</ListItemIcon>
					<ListItemText>Verify BIDS Sidecars</ListItemText>
				</ListItemButton>

				<ListItemButton onClick={() => setExpandedDataPar(!expandedDataPar)} divider={!expandedDataPar}>
					<ListItemIcon>
						<TuneIcon fontSize="large" sx={{ fontSize: "3rem" }} />
					</ListItemIcon>
					<ListItemText>Define Parameters</ListItemText>
					<ExpandMore expand={expandedDataPar} onClick={() => setExpandedDataPar(!expandedDataPar)}>
						<ExpandMoreIcon />
					</ExpandMore>
				</ListItemButton>
				<Collapse in={expandedDataPar}>
					<List component="div" disablePadding>
						<ListItemButton
							disableGutters
							sx={{ pl: 7 }}
							onClick={() => {
								setCurrentModule("DataPar");
								setDataParTab("StudyParameters");
								setExpandedDataPar(false);
								setOpen(false);
							}}
						>
							<ListItemIcon>
								<PeopleIcon sx={{ ml: 2, fontSize: "2rem" }} />
							</ListItemIcon>
							<ListItemText>Study Parameters</ListItemText>
						</ListItemButton>
						<ListItemButton
							disableGutters
							sx={{ pl: 7 }}
							onClick={() => {
								setCurrentModule("DataPar");
								setDataParTab("ModelingParameters");
								setExpandedDataPar(false);
								setOpen(false);
							}}
						>
							<ListItemIcon>
								<FunctionsIcon sx={{ ml: 2, fontSize: "2rem" }} />
							</ListItemIcon>
							<ListItemText>Modeling Parameters</ListItemText>
						</ListItemButton>
						<ListItemButton
							disableGutters
							divider
							sx={{ pl: 7 }}
							onClick={() => {
								setCurrentModule("DataPar");
								setDataParTab("ProcessParameters");
								setExpandedDataPar(false);
								setOpen(false);
							}}
						>
							<ListItemIcon>
								<SvgIcon component={ProcessIcon} inheritViewBox sx={{ ml: 2, fontSize: "2rem" }} />
							</ListItemIcon>
							<ListItemText>Processing Parameters</ListItemText>
						</ListItemButton>
					</List>
				</Collapse>

				<ListItemButton onClick={() => setExpandedProcStudies(!expandedProcStudies)} divider={!expandedProcStudies}>
					<ListItemIcon>
						<SvgIcon component={BrainSvg} inheritViewBox sx={{ fontSize: "3rem" }} />
					</ListItemIcon>
					<ListItemText>Process Studies</ListItemText>
					<ExpandMore expand={expandedProcStudies} onClick={() => setExpandedProcStudies(!expandedProcStudies)}>
						<ExpandMoreIcon />
					</ExpandMore>
				</ListItemButton>
				<Collapse in={expandedProcStudies}>
					<List component="div" disablePadding>
						<ListItemButton
							disableGutters
							sx={{ pl: 7 }}
							onClick={() => {
								setCurrentModule("ProcessStudies");
								setProcStudiesTab("RunExploreASL");
								setExpandedProcStudies(false);
								setOpen(false);
							}}
						>
							<ListItemIcon>
								<SvgIcon component={ExploreASLIcon} inheritViewBox sx={{ ml: 2, fontSize: "2rem" }} />
							</ListItemIcon>
							<ListItemText>Run ExploreASL</ListItemText>
						</ListItemButton>
						<ListItemButton
							disableGutters
							divider
							sx={{ pl: 7 }}
							onClick={() => {
								setCurrentModule("ProcessStudies");
								setProcStudiesTab("PrepareARerun");
								setExpandedProcStudies(false);
								setOpen(false);
							}}
						>
							<ListItemIcon>
								<UndoIcon sx={{ ml: 2, fontSize: "2rem" }} />
							</ListItemIcon>
							<ListItemText>Prepare A Re-Run</ListItemText>
						</ListItemButton>
					</List>
				</Collapse>

				<ListItemButton
					divider
					onClick={() => {
						setCurrentModule("DataVisualization");
						setOpen(false);
					}}
				>
					<ListItemIcon>
						<SvgIcon component={ScatterPlotIcon} inheritViewBox sx={{ fontSize: "3rem" }} />
					</ListItemIcon>
					<ListItemText>Data Visualization</ListItemText>
				</ListItemButton>

				<ListItemButton
					divider
					onClick={() => {
						setCurrentModule("About");
						setOpen(false);
					}}
				>
					<ListItemIcon>
						<InfoIcon sx={{ fontSize: "3rem" }} />
					</ListItemIcon>
					<ListItemText>About</ListItemText>
				</ListItemButton>

				<ListItemButton
					divider
					onClick={() => {
						setCurrentModule("Settings");
						setOpen(false);
					}}
				>
					<ListItemIcon>
						<SettingsIcon sx={{ fontSize: "3rem" }} />
					</ListItemIcon>
					<ListItemText>Settings</ListItemText>
				</ListItemButton>
			</List>
			<Typography
				variant="overline"
				sx={{
					fontWeight: "bold",
					position: "fixed",
					bottom: "0.5rem",
					left: "1rem",
				}}
			>
				ExploreASL GUI Version: 0.5.0
			</Typography>
		</LoweredTemporaryDrawer>
	);
}

export default ApplicationDrawer;

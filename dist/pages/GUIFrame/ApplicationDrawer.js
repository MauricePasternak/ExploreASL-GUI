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
const LoweredTemporaryDrawer = styled(Drawer)(({ width, margintop = APPBARHEIGHTPIXELS }) => ({
    marginTop: `${margintop}px`,
    "& .MuiDrawer-paper": {
        width: `${width}px`,
        boxSizing: "border-box",
        marginTop: `${margintop}px`,
    },
    "& .MuiBackdrop-root": {
        marginTop: `${margintop}px`,
    },
}));
function ApplicationDrawer({ drawerWidth = 350 }) {
    const [open, setOpen] = useAtom(atomDrawerIsOpen);
    const setCurrentModule = useSetAtom(atomCurrentGUIPage);
    const [expandedDataPar, setExpandedDataPar] = React.useState(false);
    const setDataParTab = useSetAtom(atomDataParCurrentTab);
    const [expandedProcStudies, setExpandedProcStudies] = React.useState(false);
    const setProcStudiesTab = useSetAtom(atomProcStudyCurrentTab);
    return (React.createElement(LoweredTemporaryDrawer, { width: drawerWidth, margintop: APPBARHEIGHTPIXELS, variant: "temporary", anchor: "left", open: open, onClose: () => setOpen(!open) },
        React.createElement(List, null,
            React.createElement(ListItemButton, { divider: true, onClick: () => {
                    setCurrentModule("Import");
                    setOpen(false);
                } },
                React.createElement(ListItemIcon, null,
                    React.createElement(SvgIcon, { component: DICOM2NIFTIIcon, inheritViewBox: true, sx: { fontSize: "3rem" } })),
                React.createElement(ListItemText, null, "Import A Dataset")),
            React.createElement(ListItemButton, { divider: true, onClick: () => {
                    setCurrentModule("BIDSDatagrid");
                    setOpen(false);
                } },
                React.createElement(ListItemIcon, null,
                    React.createElement(SvgIcon, { component: BIDSIcon, inheritViewBox: true, sx: { fontSize: "3rem" } })),
                React.createElement(ListItemText, null, "Verify BIDS Sidecars")),
            React.createElement(ListItemButton, { onClick: () => setExpandedDataPar(!expandedDataPar), divider: !expandedDataPar },
                React.createElement(ListItemIcon, null,
                    React.createElement(TuneIcon, { fontSize: "large", sx: { fontSize: "3rem" } })),
                React.createElement(ListItemText, null, "Define Parameters"),
                React.createElement(ExpandMore, { expand: expandedDataPar, onClick: () => setExpandedDataPar(!expandedDataPar) },
                    React.createElement(ExpandMoreIcon, null))),
            React.createElement(Collapse, { in: expandedDataPar },
                React.createElement(List, { component: "div", disablePadding: true },
                    React.createElement(ListItemButton, { disableGutters: true, sx: { pl: 7 }, onClick: () => {
                            setCurrentModule("DataPar");
                            setDataParTab("StudyParameters");
                            setExpandedDataPar(false);
                            setOpen(false);
                        } },
                        React.createElement(ListItemIcon, null,
                            React.createElement(PeopleIcon, { sx: { ml: 2, fontSize: "2rem" } })),
                        React.createElement(ListItemText, null, "Study Parameters")),
                    React.createElement(ListItemButton, { disableGutters: true, sx: { pl: 7 }, onClick: () => {
                            setCurrentModule("DataPar");
                            setDataParTab("ModelingParameters");
                            setExpandedDataPar(false);
                            setOpen(false);
                        } },
                        React.createElement(ListItemIcon, null,
                            React.createElement(FunctionsIcon, { sx: { ml: 2, fontSize: "2rem" } })),
                        React.createElement(ListItemText, null, "Modeling Parameters")),
                    React.createElement(ListItemButton, { disableGutters: true, divider: true, sx: { pl: 7 }, onClick: () => {
                            setCurrentModule("DataPar");
                            setDataParTab("ProcessParameters");
                            setExpandedDataPar(false);
                            setOpen(false);
                        } },
                        React.createElement(ListItemIcon, null,
                            React.createElement(SvgIcon, { component: ProcessIcon, inheritViewBox: true, sx: { ml: 2, fontSize: "2rem" } })),
                        React.createElement(ListItemText, null, "Processing Parameters")))),
            React.createElement(ListItemButton, { onClick: () => setExpandedProcStudies(!expandedProcStudies), divider: !expandedProcStudies },
                React.createElement(ListItemIcon, null,
                    React.createElement(SvgIcon, { component: BrainSvg, inheritViewBox: true, sx: { fontSize: "3rem" } })),
                React.createElement(ListItemText, null, "Process Studies"),
                React.createElement(ExpandMore, { expand: expandedProcStudies, onClick: () => setExpandedProcStudies(!expandedProcStudies) },
                    React.createElement(ExpandMoreIcon, null))),
            React.createElement(Collapse, { in: expandedProcStudies },
                React.createElement(List, { component: "div", disablePadding: true },
                    React.createElement(ListItemButton, { disableGutters: true, sx: { pl: 7 }, onClick: () => {
                            setCurrentModule("ProcessStudies");
                            setProcStudiesTab("RunExploreASL");
                            setExpandedProcStudies(false);
                            setOpen(false);
                        } },
                        React.createElement(ListItemIcon, null,
                            React.createElement(SvgIcon, { component: ExploreASLIcon, inheritViewBox: true, sx: { ml: 2, fontSize: "2rem" } })),
                        React.createElement(ListItemText, null, "Run ExploreASL")),
                    React.createElement(ListItemButton, { disableGutters: true, divider: true, sx: { pl: 7 }, onClick: () => {
                            setCurrentModule("ProcessStudies");
                            setProcStudiesTab("PrepareARerun");
                            setExpandedProcStudies(false);
                            setOpen(false);
                        } },
                        React.createElement(ListItemIcon, null,
                            React.createElement(UndoIcon, { sx: { ml: 2, fontSize: "2rem" } })),
                        React.createElement(ListItemText, null, "Prepare A Re-Run")))),
            React.createElement(ListItemButton, { divider: true, onClick: () => {
                    setCurrentModule("DataVisualization");
                    setOpen(false);
                } },
                React.createElement(ListItemIcon, null,
                    React.createElement(SvgIcon, { component: ScatterPlotIcon, inheritViewBox: true, sx: { fontSize: "3rem" } })),
                React.createElement(ListItemText, null, "Data Visualization")),
            React.createElement(ListItemButton, { divider: true, onClick: () => {
                    setCurrentModule("About");
                    setOpen(false);
                } },
                React.createElement(ListItemIcon, null,
                    React.createElement(InfoIcon, { sx: { fontSize: "3rem" } })),
                React.createElement(ListItemText, null, "About")),
            React.createElement(ListItemButton, { divider: true, onClick: () => {
                    setCurrentModule("Settings");
                    setOpen(false);
                } },
                React.createElement(ListItemIcon, null,
                    React.createElement(SettingsIcon, { sx: { fontSize: "3rem" } })),
                React.createElement(ListItemText, null, "Settings"))),
        React.createElement(Typography, { variant: "overline", sx: {
                fontWeight: "bold",
                position: "fixed",
                bottom: "0.5rem",
                left: "1rem",
            } }, "ExploreASL GUI Version: 0.5.0")));
}
export default ApplicationDrawer;
//# sourceMappingURL=ApplicationDrawer.js.map
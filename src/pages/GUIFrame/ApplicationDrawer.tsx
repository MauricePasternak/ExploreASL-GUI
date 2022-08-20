import CircleIcon from "@mui/icons-material/Circle";
import DynamicFormIcon from "@mui/icons-material/DynamicForm";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ImportExportIcon from "@mui/icons-material/ImportExport";
import InfoIcon from "@mui/icons-material/Info";
import Collapse from "@mui/material/Collapse";
import Drawer from "@mui/material/Drawer";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import BackupTableIcon from '@mui/icons-material/BackupTable';
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import { styled } from "@mui/material/styles";
import SvgIcon from "@mui/material/SvgIcon";
import { useAtom, useSetAtom } from "jotai";
import React from "react";
import BrainSvg from "../../assets/svg/Brain.svg";
import BIDSIcon from "../../assets/svg/BIDSIcon.svg";
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
            <ImportExportIcon fontSize="large" />
          </ListItemIcon>
          <ListItemText>Import A Dataset</ListItemText>
        </ListItemButton>

        <ListItemButton onClick={() => setExpandedDataPar(!expandedDataPar)} divider={!expandedDataPar}>
          <ListItemIcon>
            <DynamicFormIcon fontSize="large" />
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
              sx={{ pl: 4 }}
              onClick={() => {
                setCurrentModule("DataPar");
                setDataParTab("StudyParameters");
                setExpandedDataPar(false);
                setOpen(false);
              }}
            >
              <ListItemIcon>
                <CircleIcon sx={{ fontSize: "0.75rem" }} />
              </ListItemIcon>
              <ListItemText>Study Parameters</ListItemText>
            </ListItemButton>
            <ListItemButton
              disableGutters
              sx={{ pl: 4 }}
              onClick={() => {
                setCurrentModule("DataPar");
                setDataParTab("SequenceParameters");
                setExpandedDataPar(false);
                setOpen(false);
              }}
            >
              <ListItemIcon>
                <CircleIcon sx={{ fontSize: "0.75rem" }} />
              </ListItemIcon>
              <ListItemText>ASL Sequence Parameters</ListItemText>
            </ListItemButton>
            <ListItemButton
              disableGutters
              divider
              sx={{ pl: 4 }}
              onClick={() => {
                setCurrentModule("DataPar");
                setDataParTab("ProcessParameters");
                setExpandedDataPar(false);
                setOpen(false);
              }}
            >
              <ListItemIcon>
                <CircleIcon sx={{ fontSize: "0.75rem" }} />
              </ListItemIcon>
              <ListItemText>Processing Parameters</ListItemText>
            </ListItemButton>
          </List>
        </Collapse>

        <ListItemButton
          divider
          onClick={() => {
            setCurrentModule("BIDSDatagrid");
            setOpen(false);
          }}
        >
          <ListItemIcon>
            <SvgIcon component={BIDSIcon} inheritViewBox fontSize="large" />
          </ListItemIcon>
          <ListItemText>Edit BIDS Sidecars</ListItemText>
        </ListItemButton>

        <ListItemButton onClick={() => setExpandedProcStudies(!expandedProcStudies)} divider={!expandedProcStudies}>
          <ListItemIcon>
            <SvgIcon component={BrainSvg} inheritViewBox fontSize="large" />
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
              sx={{ pl: 4 }}
              onClick={() => {
                setCurrentModule("ProcessStudies");
                setProcStudiesTab("RunExploreASL");
                setExpandedProcStudies(false);
                setOpen(false);
              }}
            >
              <ListItemIcon>
                <CircleIcon sx={{ fontSize: "0.75rem" }} />
              </ListItemIcon>
              <ListItemText>Run ExploreASL</ListItemText>
            </ListItemButton>
            <ListItemButton
              disableGutters
              divider
              sx={{ pl: 4 }}
              onClick={() => {
                setCurrentModule("ProcessStudies");
                setProcStudiesTab("PrepareARerun");
                setExpandedProcStudies(false);
                setOpen(false);
              }}
            >
              <ListItemIcon>
                <CircleIcon sx={{ fontSize: "0.75rem" }} />
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
            <SvgIcon component={ScatterPlotIcon} inheritViewBox fontSize="large" />
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
            <InfoIcon fontSize="large" />
          </ListItemIcon>
          <ListItemText>About</ListItemText>
        </ListItemButton>
      </List>
    </LoweredTemporaryDrawer>
  );
}

export default ApplicationDrawer;

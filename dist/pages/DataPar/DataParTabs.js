import ErrorIcon from "@mui/icons-material/Error";
import FunctionsIcon from "@mui/icons-material/Functions";
import PeopleIcon from "@mui/icons-material/People";
import Paper from "@mui/material/Paper";
import SvgIcon from "@mui/material/SvgIcon";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import { useAtom, useAtomValue } from "jotai";
import React from "react";
import { useFormState } from "react-hook-form";
import ProcessIcon from "../../assets/svg/ArrowsSpinSolid.svg";
import { APPBARHEIGHTPIXELS } from "../../common/GLOBALS";
import { parseNestedFormattedYupErrors } from "../../common/utils/formFunctions";
import { atomDataParCurrentTab } from "../../stores/DataParStore";
import { atomCurrentGUIPage } from "../../stores/GUIFrameStore";
const dataParTabs = {
    StudyParameters: {
        label: "Study Parameters",
        fieldNames: new Set([
            "x.GUI.EASLPath",
            "x.GUI.EASLType",
            "x.GUI.StudyRootPath",
            "x.GUI.SUBJECTS",
            "x.GUI.MATLABRuntimePath",
            "x.dataset.exclusion",
            "x.dataset.name",
        ]),
        icon: React.createElement(PeopleIcon, null),
    },
    ModelingParameters: {
        label: "Modeling Parameters",
        fieldNames: new Set([
            "x.Q.SliceReadoutTime",
            "x.Q.bUseBasilQuantification",
            "x.Q.Lambda",
            "x.Q.T2art",
            "x.Q.BloodT1",
            "x.Q.TissueT1",
            "x.Q.nCompartments",
            "x.Q.ApplyQuantification",
            "x.Q.SaveCBF4D",
        ]),
        icon: React.createElement(FunctionsIcon, null),
    },
    ProcessParameters: {
        label: "Processing Parameters",
        fieldNames: new Set([
            "x.modules.asl.M0_conventionalProcessing",
            "x.modules.asl.M0_GMScaleFactor",
            "x.modules.asl.motionCorrection",
            "x.modules.asl.SpikeRemovalThreshold",
            "x.modules.asl.bRegistrationContrast",
            "x.modules.asl.bAffineRegistration",
            "x.modules.asl.bDCTRegistration",
            "x.modules.asl.bRegisterM02ASL",
            "x.modules.asl.bUseMNIasDummyStructural",
            "x.modules.asl.bPVCNativeSpace",
            "x.modules.asl.PVCNativeSpaceKernel",
            "x.modules.asl.bPVCGaussianMM",
            "x.modules.asl.MakeNIfTI4DICOM",
            "x.modules.bRunLongReg",
            "x.modules.bRunDARTEL",
            "x.modules.WMHsegmAlg",
            "x.modules.structural.bSegmentSPM12",
            "x.modules.structural.bHammersCAT12",
            "x.modules.structural.bFixResolution",
            "x.settings.Quality",
            "x.settings.DELETETEMP",
            "x.settings.SkipIfNoFlair",
            "x.settings.SkipIfNoASL",
            "x.settings.SkipIfNoM0",
            "x.S.bMasking",
            "x.S.Atlases",
        ]),
        icon: React.createElement(SvgIcon, { component: ProcessIcon, inheritViewBox: true }),
    },
};
function DataParTabs({ control }) {
    // Tabs need to unmount depending on the current page
    const currentGUIPage = useAtomValue(atomCurrentGUIPage);
    const [currentTab, setCurrentTab] = useAtom(atomDataParCurrentTab);
    const { errors } = useFormState({ control: control });
    // console.log(`DataParTabs: errors`, errors);
    const errKeys = Object.keys(parseNestedFormattedYupErrors(errors));
    return (React.createElement(Paper, { elevation: 2, sx: {
            position: "sticky",
            top: APPBARHEIGHTPIXELS,
            zIndex: 10,
        } }, currentGUIPage === "DataPar" && (React.createElement(Tabs, { variant: "scrollable", scrollButtons: true, allowScrollButtonsMobile: true, value: currentTab, onChange: (e, v) => setCurrentTab(v), sx: {
            width: "100%",
            justifyContent: "center",
            "& .MuiTabs-scroller": {
                flexGrow: 0,
            },
            "& .MuiTabs-indicator": {
                backgroundColor: errKeys.length > 0 ? "error.main" : "default",
            },
        } }, Object.entries(dataParTabs).map(([tab, { label, fieldNames, icon }]) => {
        const containsError = errKeys.some((key) => fieldNames.has(key));
        console.log(`DataParTab with label: ${label} contains error: ${containsError}`);
        return (React.createElement(Tab, { key: `DataParTab_${label}`, sx: {
                color: containsError ? "error.main" : "default",
                "&.Mui-selected": {
                    color: containsError ? "error.main" : "default",
                },
                "&.Mui-selected svg": {
                    fill: (theme) => (containsError ? theme.palette.error.main : theme.palette.primary.main),
                },
            }, label: label, value: tab, icon: containsError ? React.createElement(ErrorIcon, null) : icon, iconPosition: "start" }));
    })))));
}
export default DataParTabs;
//# sourceMappingURL=DataParTabs.js.map
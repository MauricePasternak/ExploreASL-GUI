import UndoIcon from "@mui/icons-material/Undo";
import Paper from "@mui/material/Paper";
import { styled } from "@mui/material/styles";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import { useAtom, useAtomValue } from "jotai";
import React from "react";
import ExploreASLIcon from "../../assets/svg/ExploreASLIcon.svg";
import { APPBARHEIGHTPIXELS } from "../../common/GLOBALS";
import { atomCurrentGUIPage } from "../../stores/GUIFrameStore";
import { atomProcStudyCurrentTab } from "../../stores/ProcessStudiesStore";
const TabExploreASLIcon = styled(ExploreASLIcon)(({ theme }) => ({
    height: "1.5rem",
    width: "1.5rem",
    fill: theme.palette.text.secondary,
}));
const procStudiesTabs = [
    { label: "Run ExploreASL", value: "RunExploreASL", icon: React.createElement(TabExploreASLIcon, null) },
    { label: "Prepare a Re-run", value: "PrepareARerun", icon: React.createElement(UndoIcon, null) },
];
function ProcessStudiesTabs() {
    const [currentTab, setCurrentTab] = useAtom(atomProcStudyCurrentTab);
    const currentGUIPage = useAtomValue(atomCurrentGUIPage);
    return (React.createElement(Paper, { elevation: 2, sx: {
            position: "sticky",
            top: APPBARHEIGHTPIXELS,
            zIndex: 10,
        } }, currentGUIPage === "ProcessStudies" && (React.createElement(Tabs, { variant: "scrollable", scrollButtons: true, allowScrollButtonsMobile: true, value: currentTab, onChange: (e, v) => setCurrentTab(v), sx: {
            width: "100%",
            justifyContent: "center",
            "& .MuiTabs-scroller": {
                flexGrow: 0,
            },
        } }, procStudiesTabs.map(({ label, value, icon }, tabIndex) => {
        return (React.createElement(Tab, { key: `ProcessStudiesTab_${tabIndex}_${label}`, sx: {
                "&.Mui-selected svg": {
                    fill: (theme) => theme.palette.primary.main,
                },
            }, value: value, icon: icon, label: label, iconPosition: "start" }));
    })))));
}
export default ProcessStudiesTabs;
//# sourceMappingURL=ProcessStudiesTabs.js.map
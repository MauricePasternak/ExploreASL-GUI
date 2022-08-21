import UndoIcon from "@mui/icons-material/Undo";
import Paper from "@mui/material/Paper";
import { styled } from "@mui/material/styles";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import { useAtom, useAtomValue } from "jotai";
import React from "react";
import ExploreASLIcon from "../../assets/svg/ExploreASLIcon.svg";
import { APPBARHEIGHTPIXELS } from "../../common/GLOBALS";
import { ProcessStudiesTabOption } from "../../common/types/ProcessStudiesTypes";
import { atomCurrentGUIPage } from "../../stores/GUIFrameStore";
import { atomProcStudyCurrentTab } from "../../stores/ProcessStudiesStore";

const TabExploreASLIcon = styled(ExploreASLIcon)(({ theme }) => ({
  height: "1.5rem",
  width: "1.5rem",
  fill: theme.palette.text.secondary,
}));

type ProcessStudiesTabProps = {
  label: React.ReactNode;
  icon?: React.ReactElement;
  value: ProcessStudiesTabOption;
};

const procStudiesTabs: ProcessStudiesTabProps[] = [
  { label: "Run ExploreASL", value: "RunExploreASL", icon: <TabExploreASLIcon /> },
  { label: "Prepare a Re-run", value: "PrepareARerun", icon: <UndoIcon /> },
];

function ProcessStudiesTabs() {
  const [currentTab, setCurrentTab] = useAtom(atomProcStudyCurrentTab);
  const currentGUIPage = useAtomValue(atomCurrentGUIPage);

  return (
    <Paper
      elevation={2}
      sx={{
        position: "sticky",
        top: APPBARHEIGHTPIXELS,
        zIndex: 10,
      }}
    >
      {currentGUIPage === "ProcessStudies" && (
        <Tabs
          variant="scrollable"
          scrollButtons
          allowScrollButtonsMobile
          value={currentTab}
          onChange={(e, v) => setCurrentTab(v)}
          sx={{
            width: "100%",
            justifyContent: "center",
            "& .MuiTabs-scroller": {
              flexGrow: 0,
            },
          }}
        >
          {procStudiesTabs.map(({ label, value, icon }, tabIndex) => {
            return (
              <Tab
                key={`ProcessStudiesTab_${tabIndex}_${label}`}
                sx={{
                  "&.Mui-selected svg": {
                    fill: theme => theme.palette.primary.main,
                  },
                }}
                value={value}
                icon={icon}
                label={label}
                iconPosition="start"
              />
            );
          })}
        </Tabs>
      )}
    </Paper>
  );
}

export default ProcessStudiesTabs;

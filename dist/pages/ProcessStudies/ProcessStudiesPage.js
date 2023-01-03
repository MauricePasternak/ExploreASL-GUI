import Box from "@mui/material/Box";
import { useAtomValue } from "jotai";
import React from "react";
import { atomProcStudyCurrentTab } from "../../stores/ProcessStudiesStore";
import ProcessStudiesTabs from "./ProcessStudiesTabs";
import SubmoduleReRunAStudy from "./SubmoduleReRunAStudy";
import SubmoduleRunEASL from "./SubmoduleRunEASL";
export const ProcessStudiesPage = React.memo(() => {
    const currentProcessStudiesTab = useAtomValue(atomProcStudyCurrentTab);
    return (React.createElement(React.Fragment, null,
        React.createElement(ProcessStudiesTabs, null),
        React.createElement(Box, { className: "ProcessStudies__TabContentContainer" },
            React.createElement(Box, { display: currentProcessStudiesTab === "RunExploreASL" ? "block" : "none" },
                React.createElement(SubmoduleRunEASL, null)),
            React.createElement(Box, { display: currentProcessStudiesTab === "PrepareARerun" ? "block" : "none" },
                React.createElement(SubmoduleReRunAStudy, null)))));
});
//# sourceMappingURL=ProcessStudiesPage.js.map
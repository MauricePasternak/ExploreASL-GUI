import Grid from "@mui/material/Grid";
import Typography from "@mui/material/Typography";
import { useAtomValue } from "jotai";
import React from "react";
import { atomCurrentMRIViewSubject, atomOfAtomMRIData, atomOfAtomMRISlices } from "../../../stores/DataFrameVisualizationStore";
import MRISingleView from "./MRISingleView";
function MRIMultiView() {
    const atomsMRISlices = useAtomValue(atomOfAtomMRISlices);
    const atomsMRIDataset = useAtomValue(atomOfAtomMRIData);
    const currentMRIViewSubject = useAtomValue(atomCurrentMRIViewSubject);
    function renderMRIViews() {
        const result = [];
        for (let index = 0; index < atomsMRIDataset.length; index++) {
            const atomMRIData = atomsMRIDataset[index];
            const atomMRISlice = atomsMRISlices[index];
            const orientation = index === 0 ? "Axial" : index === 1 ? "Coronal" : "Sagittal";
            result.push(React.createElement(Grid, { item: true, xs: 12, lg: 6, xl: 4, position: "relative", height: {
                    xs: "400px",
                    lg: "500px",
                }, bgcolor: "black", padding: 4, textAlign: "center", key: `${atomMRIData}`, className: `MRIViewContainer__${orientation}` },
                React.createElement(Typography, { variant: "h6", color: "white", className: `MRIViewLabel__${orientation}` }, currentMRIViewSubject === "" ? orientation : `${currentMRIViewSubject} - ${orientation}`),
                React.createElement(MRISingleView, { atomMRIData: atomMRIData, atomMRISlice: atomMRISlice, orientation: orientation })));
        }
        return result;
    }
    return React.createElement(React.Fragment, null, renderMRIViews());
}
export default React.memo(MRIMultiView);
//# sourceMappingURL=MRIMultiView.js.map
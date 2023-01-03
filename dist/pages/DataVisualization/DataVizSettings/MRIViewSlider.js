var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
import Box from "@mui/material/Box";
import FormControl from "@mui/material/FormControl";
import FormLabel from "@mui/material/FormLabel";
import Slider from "@mui/material/Slider";
import Typography from "@mui/material/Typography";
import { useAtom } from "jotai";
import React from "react";
function MRIViewSlider(_a) {
    var { atomMRISlice, label } = _a, sliderProps = __rest(_a, ["atomMRISlice", "label"]);
    const [slice, setSlice] = useAtom(atomMRISlice);
    return (React.createElement(FormControl, null,
        React.createElement(FormLabel, null, label),
        React.createElement(Slider, Object.assign({ min: 1, step: 1, value: slice, onChange: (e, v) => !Array.isArray(v) && setSlice(v), valueLabelDisplay: "auto" }, sliderProps)),
        React.createElement(Box, { display: "flex", justifyContent: "space-between" },
            label === "Axial" && (React.createElement(React.Fragment, null,
                React.createElement(Typography, { variant: "caption" }, "Inferior"),
                React.createElement(Typography, { variant: "caption" }, "Superior"))),
            label === "Coronal" && (React.createElement(React.Fragment, null,
                React.createElement(Typography, { variant: "caption" }, "Posterior"),
                React.createElement(Typography, { variant: "caption" }, "Anterior"))),
            label === "Sagittal" && (React.createElement(React.Fragment, null,
                React.createElement(Typography, { variant: "caption" }, "Right"),
                React.createElement(Typography, { variant: "caption" }, "Left"))))));
}
export default MRIViewSlider;
//# sourceMappingURL=MRIViewSlider.js.map
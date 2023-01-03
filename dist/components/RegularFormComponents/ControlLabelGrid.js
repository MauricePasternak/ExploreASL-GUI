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
import FormControlLabel from "@mui/material/FormControlLabel";
import Slider from "@mui/material/Slider";
import { styled } from "@mui/material/styles";
import Switch from "@mui/material/Switch";
import React from "react";
export const ControlLabelGrid = styled(FormControlLabel)(({ labelwidth }) => ({
    display: "grid",
    gridTemplateColumns: `${labelwidth} 1fr`,
}));
export const ControlledLabelSlider = styled((props) => {
    const { labelwidth, label } = props, sliderProps = __rest(props, ["labelwidth", "label"]);
    return (React.createElement(ControlLabelGrid, { label: label, labelwidth: labelwidth, labelPlacement: "start", control: React.createElement(Slider, Object.assign({}, sliderProps)) }));
})(() => ({
    order: 1,
}));
export const ControlledLabelSwitch = styled((props) => {
    const { label, labelwidth } = props, switchProps = __rest(props, ["label", "labelwidth"]);
    return (React.createElement(ControlLabelGrid, { label: label, labelwidth: labelwidth, labelPlacement: "start", control: React.createElement(Switch, Object.assign({}, switchProps)) }));
})(() => ({
    order: 1,
}));
//# sourceMappingURL=ControlLabelGrid.js.map
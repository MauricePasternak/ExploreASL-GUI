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
import FormControl from "@mui/material/FormControl";
import FormHelperText from "@mui/material/FormHelperText";
import InputLabel from "@mui/material/InputLabel";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import React from "react";
function LabelledSelect(_a) {
    var { options, label, helperText, helperTextProps, variant = "outlined" } = _a, props = __rest(_a, ["options", "label", "helperText", "helperTextProps", "variant"]);
    return (React.createElement(FormControl, { component: "fieldset", variant: variant, fullWidth: props.fullWidth, error: props.error, disabled: props.disabled },
        label && React.createElement(InputLabel, null, label),
        React.createElement(Select, Object.assign({}, props, { variant: variant, label: label }), options.map((option, index) => {
            return (React.createElement(MenuItem, Object.assign({ key: `LabelledSelectMenuItem__${label}__${index}` }, option), option.label));
        })),
        helperText && React.createElement(FormHelperText, Object.assign({}, helperTextProps), helperText)));
}
export default LabelledSelect;
//# sourceMappingURL=LabelledSelect.js.map
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
import Typography from "@mui/material/Typography";
import createColormap from "colormap";
import { round as lodashRound } from "lodash";
import React from "react";
import { linspace } from "../common/utils/arrayFunctions";
export function generateLinearGradient(cmap, nSteps, direction = "to top") {
    const colors = createColormap({
        colormap: cmap,
        nshades: nSteps,
        format: "hex",
    });
    return `linear-gradient(${direction}, ${colors.map(c => `${c}`).join(", ")})`;
}
/**
 * Basic color bar component.
 * @param max The maximum value of the colorbar. Defaults to 1000.
 * @param min The minimum value of the colorbar. Defaults to 0.
 * @param nshades The number of colors in the colorbar. Defaults to 10.
 * @param cmap The colormap to use. Defaults to "greys".
 * @param nlabels The number of labels to display. Defaults to 5.
 * @param title The title of the colorbar. Defaults to "".
 * @param cmapDirection The direction of the gradient. Defaults to "to top".
 * @param reverseLabels Whether to reverse the order of the labels. Defaults to `true`.
 * @param height The height of the colorbar. Defaults to `100%`.
 */
function ColorBar(_a) {
    var { max = 1000, min = 0, nshades = 10, cmap = "greys", nlabels = 5, title = "", cmapDirection = "to top", reverseLabels = true } = _a, boxProps = __rest(_a, ["max", "min", "nshades", "cmap", "nlabels", "title", "cmapDirection", "reverseLabels"]);
    const data = createColormap({
        colormap: cmap,
        nshades: nshades,
        format: "hex",
    }).reverse();
    const gradient = generateLinearGradient(cmap, nshades, cmapDirection);
    const legendRows = linspace(min, max, nlabels).map(v => {
        return (React.createElement(Typography, { key: v, variant: "body1", color: "white" }, lodashRound(v, 0)));
    });
    return (React.createElement(Box, Object.assign({ display: "flex", gap: 1, className: "Colorbar__MainContainer" }, boxProps),
        React.createElement(Box, { sx: {
                background: gradient,
            }, height: "100%", width: "12px", className: "Colorbar__ColorBar" }),
        React.createElement(Box, { display: "flex", flexDirection: "column", height: "calc(100% + 20px)", justifyContent: "space-between", sx: { transform: "translateY(-10px)" }, className: "Colorbar__LegendContainer" }, reverseLabels ? legendRows.reverse() : legendRows),
        title && (React.createElement(Typography, { alignSelf: "center", sx: { writingMode: "vertical-lr", color: "white" }, variant: "h6" }, title))));
}
export default ColorBar;
export const memoColorBar = React.memo(ColorBar);
//# sourceMappingURL=ColorBar.js.map
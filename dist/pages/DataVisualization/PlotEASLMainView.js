var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import ScatterPlotIcon from "@mui/icons-material/ScatterPlot";
import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardHeader from "@mui/material/CardHeader";
import Divider from "@mui/material/Divider";
import Grid from "@mui/material/Grid";
import Paper from "@mui/material/Paper";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { toPng } from "html-to-image";
import { useAtomValue, useSetAtom } from "jotai";
import React, { useRef } from "react";
import { atomDataVizCurrentStep, atomNivoGraphDataVariablesSchema, atomNivoGraphType, } from "../../stores/DataFrameVisualizationStore";
import { atomDataVizModuleSnackbar } from "../../stores/SnackbarStore";
import EASLScatterplot from "./DataVizPlots/EASLScatterplot";
import EASLSwarmplot from "./DataVizPlots/EASLSwarmplot";
import PlotSettingsDrawer from "./DataVizSettings/PlotSettingsDrawer";
import MRIMultiView from "./MRIView/MRIMultiView";
function PlotEASLMainView() {
    const graphType = useAtomValue(atomNivoGraphType);
    const dataVarsSchema = useAtomValue(atomNivoGraphDataVariablesSchema);
    const setDataVizSnackbar = useSetAtom(atomDataVizModuleSnackbar);
    const validAxisVars = !!dataVarsSchema.XAxisVar &&
        dataVarsSchema.XAxisVar !== "" &&
        !!dataVarsSchema.YAxisVar &&
        dataVarsSchema.YAxisVar !== "";
    const canRenderScatterplot = graphType === "Scatterplot" && validAxisVars;
    const canRenderSwarmplot = graphType === "Swarmplot" && validAxisVars;
    const setDataVizCurrentStep = useSetAtom(atomDataVizCurrentStep);
    const figureContainer = useRef(null);
    const handleSavePNGFigure = () => __awaiter(this, void 0, void 0, function* () {
        if (!figureContainer.current)
            return;
        try {
            const dataUrl = yield toPng(figureContainer.current, { cacheBust: true });
            const link = document.createElement("a");
            link.download = "ExploreASL-GUIPlot.png";
            link.href = dataUrl;
            link.click();
            link.remove();
        }
        catch (error) {
            setDataVizSnackbar({
                severity: "error",
                title: "Error saving figure as PNG",
                message: ["Could not save figure as PNG due to error:", error.message],
            });
        }
    });
    return (React.createElement(Box, { display: "flex", padding: 3 },
        React.createElement(Grid, { pb: 3, container: true, className: "PlotEASLMain__GridContainer", 
            // The widths below are necessary to offset the width of the PlotSettingsDrawer
            width: {
                xs: "calc(100% - 300px)",
                sm: "calc(100% - 300px)",
                md: "calc(100% - 400px)",
                lg: "calc(100% - 500px)",
            } },
            React.createElement(Grid, { item: true, xs: 12 },
                React.createElement(Card, null,
                    React.createElement(CardHeader, { title: React.createElement(Typography, { variant: "h4" }, "Data Visualization"), subheader: React.createElement(Typography, null, "Plot an interactive chart and load CBF volumes from individual subjects/visits/sessions by clicking on data points"), avatar: React.createElement(Avatar, { sizes: "large" },
                            React.createElement(ScatterPlotIcon, null)) }),
                    React.createElement(Divider, null))),
            React.createElement(Grid, { container: true, item: true, xs: 12, id: "PlotEASLMain__FigureContainer", ref: figureContainer, sx: {
                    backgroundColor: "background.paper",
                } },
                React.createElement(Grid, { item: true, xs: 12, sx: {
                        display: "flex",
                        flexGrow: 1,
                        position: "relative",
                        height: {
                            xs: "300px",
                            sm: "500px",
                            md: "600px",
                            lg: "800px",
                        },
                        mb: 0,
                    }, className: "PlotEASLMain__CanvasContainer" },
                    canRenderSwarmplot && React.createElement(EASLSwarmplot, null),
                    canRenderScatterplot && React.createElement(EASLScatterplot, null),
                    !canRenderSwarmplot && !canRenderScatterplot && (React.createElement(Stack, { width: "100%" },
                        React.createElement(Skeleton, { sx: {
                                position: "relative",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                height: {
                                    xs: "300px",
                                    sm: "700px",
                                    md: "600px",
                                    lg: "800px",
                                },
                            }, variant: "rectangular", width: "100%" }),
                        React.createElement(Skeleton, { variant: "text" }),
                        React.createElement(Typography, { variant: "caption" }, "The above will render a chart once the appropriate variables are indicated")))),
                React.createElement(MRIMultiView, null))),
        React.createElement(PlotSettingsDrawer, null),
        React.createElement(Paper, { elevation: 10, sx: {
                position: "fixed",
                left: 0,
                bottom: 0,
                px: 2,
                borderRadius: 0,
                display: "flex",
                justifyContent: "space-between",
                width: {
                    xs: "calc(100% - 300px)",
                    sm: "calc(100% - 300px)",
                    md: "calc(100% - 400px)",
                    lg: "calc(100% - 500px)",
                },
            } },
            React.createElement(Button, { onClick: () => setDataVizCurrentStep("DefineDTypes") }, "Return To Clarify Data Types"),
            React.createElement(Button, { disabled: !canRenderScatterplot && !canRenderSwarmplot, onClick: handleSavePNGFigure }, "Export Figure to PNG"))));
}
export default React.memo(PlotEASLMainView);
//# sourceMappingURL=PlotEASLMainView.js.map
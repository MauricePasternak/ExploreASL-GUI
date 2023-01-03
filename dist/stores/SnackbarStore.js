/**
 * Store for containing all the atomicSnackbar states throughout the GUI
 */
import { atom } from "jotai";
export const atomImportModuleSnackbar = atom({
    severity: "info",
    title: "",
    message: "",
});
export const atomDataParModuleSnackbar = atom({
    severity: "info",
    title: "",
    message: "",
});
export const atomProcessStudiesSnackbar = atom({
    severity: "info",
    title: "",
    message: "",
});
export const atomDataVizModuleSnackbar = atom({
    severity: "info",
    title: "",
    message: "",
});
export const atomBIDSDatagridSnackbar = atom({
    severity: "info",
    title: "",
    message: "",
});
//# sourceMappingURL=SnackbarStore.js.map
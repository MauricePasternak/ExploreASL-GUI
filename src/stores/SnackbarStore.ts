/**
 * Store for containing all the atomicSnackbar states throughout the GUI
 */

import { atom } from "jotai";
import { SnackbarMessageConfig } from "../components/AtomicComponents/AtomicSnackbarMessage";

export const atomImportModuleSnackbar = atom<SnackbarMessageConfig>({
  severity: "info",
  title: "",
  message: "",
});

export const atomDataParModuleSnackbar = atom<SnackbarMessageConfig>({
  severity: "info",
  title: "",
  message: "",
});

export const atomProcessStudiesSnackbar = atom<SnackbarMessageConfig>({
  severity: "info",
  title: "",
  message: "",
});

export const atomDataVizModuleSnackbar = atom<SnackbarMessageConfig>({
  severity: "info",
  title: "",
  message: "",
});

export const atomBIDSDatagridSnackbar = atom<SnackbarMessageConfig>({
  severity: "info",
  title: "",
  message: "",
});

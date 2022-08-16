import { atom } from "jotai";
import { GUIPageNames } from "../common/types/GUIFrameTypes";

export const atomCurrentGUIPage = atom<GUIPageNames>("BIDSDatagrid");
export const atomDrawerIsOpen = atom(false);

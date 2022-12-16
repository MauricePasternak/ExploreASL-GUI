import { atom } from "jotai";
import { GUIPageNames } from "../common/types/GUIFrameTypes";

export const atomCurrentGUIPage = atom<GUIPageNames>("ProcessStudies");
export const atomDrawerIsOpen = atom(false);

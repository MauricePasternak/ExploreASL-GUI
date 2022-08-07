import { atom } from "jotai";
import { GUIPageNames } from "../common/types/GUIFrameTypes";

export const atomCurrentGUIPage = atom<GUIPageNames>("About");
export const atomDrawerIsOpen = atom(false);

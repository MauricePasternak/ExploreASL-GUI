import { atomWithStorage } from "jotai/utils";

export const atomDarkMode = atomWithStorage("darkMode", true);
export const atomPreferredExploreASLPath = atomWithStorage("preferredExploreASLPath", "");
export const atomPreferredMATLABRuntimePath = atomWithStorage("preferredMATLABRuntimePath", "");

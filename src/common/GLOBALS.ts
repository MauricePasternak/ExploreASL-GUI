import { CSSSize } from "./types/cssTypes";
import { range } from "./utilityFunctions/arrayFunctions";

export const APPBARHEIGHTPIXELS = 48;
export const MEDIAPROTOCOL = "mpprotocol"; // Priviledged protocol for loading local media files into app.
export const QUILLFONTSIZES = Array.from(
  range(1, 100).flatMap(i => ["px", "em", "rem", "ch", "cm", "mm", "in", "%"].map(unit => `${i}${unit}`))
) as CSSSize[];
export const QUILLFONTFAMILIES = ["inconsolata", "roboto", "mirza", "arial"];
export const SUPPORTEDMATLABRUNTIMEVERSIONS = ["v96", "v97", "v98", "v99", "v910", "v911", "v912"];
export const GLOBAL_CHILD_PROCESSES: number[] = [];
export const STUDYPARFILE_BASENAME = "studyPar.json";
export const DATAPARFILE_BASENAME = "dataPar.json";
export const GUIIMPORTFILE_BASENAME = "EASLGUI_ImportPar.json";
export const SOURCESTRUCTUREFILE_BASENAME = "sourceStructure.json";

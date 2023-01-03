import { range } from "./utils/arrayFunctions";
import { Regex } from "./utils/Regex";
export const APPBARHEIGHTPIXELS = 48;
export const MEDIAPROTOCOL = "mpprotocol"; // Priviledged protocol for loading local media files into app.
export const QUILLFONTSIZES = Array.from(range(1, 100).flatMap((i) => ["px", "em", "rem", "ch", "cm", "mm", "in", "%"].map((unit) => `${i}${unit}`)));
export const QUILLFONTFAMILIES = ["inconsolata", "roboto", "mirza", "arial"];
export const SUPPORTEDMATLABRUNTIMEVERSIONS = ["v96", "v97", "v98", "v99", "v910", "v911", "v912"];
export const GLOBAL_CHILD_PROCESSES = [];
export const STUDYPARFILE_BASENAME = "studyPar.json";
export const DATAPARFILE_BASENAME = "dataPar.json";
export const GUIIMPORTFILE_BASENAME = "EASLGUI_ImportPar.json";
export const SOURCESTRUCTUREFILE_BASENAME = "sourceStructure.json";
export const REGEXLOCKDIR = new Regex("lock\\/xASL_module_(?<Module>ASL|Structural|Population|DARTEL_T1|LongReg)\\/?(?<Subject>.*)?\\/xASL_module_(?:ASL|Structural|Population|DARTEL|LongReg)_?(?<Session>.*)\\/locked$", "m");
export const REGEXSTATUSFULE = new Regex("lock\\/xASL_module_(?<Module>ASL|Structural|Population|DARTEL_T1|LongReg)\\/?(?<Subject>.*)?\\/xASL_module_(?:ASL|Structural|Population|DARTEL|LongReg)_?(?<Session>.*)\\/(?<StatusBasename>(?<StatusCode>\\d{3}).*\\.status)$", "m");
export const REGEXIMAGEFILE = new Regex("(?<Axis>Cor|Tra)_(?<ImageType>Reg_rT1|Seg_rT1|Reg_noSmooth_M0|noSmooth_M0|Reg_qCBF|qCBF)(?!.*Contour)_(?<Target>[\\w-]+?_\\d?)_?.*\\.jpe?g$", "m");
//# sourceMappingURL=GLOBALS.js.map
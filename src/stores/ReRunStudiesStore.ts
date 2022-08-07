import { atom } from "jotai";
import Path, { treeBranch } from "pathlib-js";
import { selectedNodeType } from "../components/FileTreeViewComponents/AtomicFilepathTreeView";

export const atomReRunStudiesTree = atom<treeBranch<Path>>({} as treeBranch<Path>);
export const atomReRunStudiesSelectedNodes = atom<selectedNodeType[]>([]);
export const ReRunStudiesChannelBaseName = "ReRunStudies"


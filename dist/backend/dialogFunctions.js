var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { dialog } from "electron";
/**
 * Handler for the "Dialog:OpenDialog" event.
 * @param event The IPCMainInvokeEvent object passed to the handler function.
 * @param options Electron dialog options. In particular, the following properties are of note:
 * - `title`: The title of the dialog.
 * - `defaultPath`: The filepath that the dialog will default to.
 * - `filters`: An array of {name: string; extensions: string[]} objects,
 * each of which represents an inclusive filter.
 * - `properties`: An array of strings that represent the behavior of the dialog:
 *
 *    - * openFile: Open a file dialog.
 *    - * openDirectory: Open a directory dialog.
 *    - * multiSelections: Allow multiple files to be selected.
 * @returns A tuple of [canceled, filePaths]
 */
export function handleFilepathDialogue(event, options = { title: "Alert", properties: ["openFile"] }) {
    return __awaiter(this, void 0, void 0, function* () {
        return yield dialog.showOpenDialog(options);
    });
}
/**
 * Handler for the "Dialog:OpenMessageBox" event.
 * @param event The IPCMainInvokeEvent object passed to the handler function.
 * @param options Electron MessageBox options. In particular, the following properties are of note:
 * - `message`: The message to display in the dialog.
 * - `type`: The type of dialog to display. One of "none", "info", "error", "question", "warning".
 * - `buttons`: An array of strings that represent the buttons to display in the dialog.
 * @returns The index of the clicked buttons.
 */
export function handleMessageBox(event, options) {
    return __awaiter(this, void 0, void 0, function* () {
        return yield dialog.showMessageBox(options);
    });
}
//# sourceMappingURL=dialogFunctions.js.map
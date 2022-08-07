import { dialog, IpcMainInvokeEvent, OpenDialogOptions, MessageBoxOptions } from "electron";

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
export async function handleFilepathDialogue(
  event: IpcMainInvokeEvent,
  options: OpenDialogOptions = { title: "Alert", properties: ["openFile"] }
) {
  return await dialog.showOpenDialog(options);
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
export async function handleMessageBox(event: IpcMainInvokeEvent, options: MessageBoxOptions) {
  return await dialog.showMessageBox(options);
}

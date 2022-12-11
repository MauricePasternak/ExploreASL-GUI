import { GUIMessage, GUIMessageSeverity } from "../types/GUIMessageTypes";

/**
 * Helper function to create a GUIMessage object.
 * @param message A string or array of strings to be displayed containing the message
 * @param title The title of the message. Defaults to "Error".
 * @param severity The severity of the message. Defaults to "error".
 * @returns A {@link GUIMessage} object.
 */
export function createGUIMessage(
  message: string | string[],
  title?: string,
  severity?: GUIMessageSeverity
): GUIMessage {
  return {
    title: title ?? "Error",
    messages: message,
    severity: severity ?? "error",
  };
}

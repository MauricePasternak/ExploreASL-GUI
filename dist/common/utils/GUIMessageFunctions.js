/**
 * Helper function to create a GUIMessage object.
 * @param message A string or array of strings to be displayed containing the message
 * @param title The title of the message. Defaults to "Error".
 * @param severity The severity of the message. Defaults to "error".
 * @returns A {@link GUIMessage} object.
 */
export function createGUIMessage(message, title, severity) {
    return {
        title: title !== null && title !== void 0 ? title : "Error",
        messages: message,
        severity: severity !== null && severity !== void 0 ? severity : "error",
    };
}
//# sourceMappingURL=GUIMessageFunctions.js.map
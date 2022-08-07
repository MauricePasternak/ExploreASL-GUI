export type GUIMessageSeverity = "success" | "info" | "warning" | "error";

/**
 * Base Type for declaring messages components should use to communicate.
 * Keys:
 * - `title` -- (Optional) -- `string`
 * - `messages`-- (Required) -- `string[] | string`
 * - `severity` -- (Required) -- `"success" | "info" | "warning" | "error";`
 */
export interface GUIMessage {
  title?: string;
  messages: string[] | string;
  severity: GUIMessageSeverity;
}

/**
 * Base Type for declaring messages accompanied by an inferred payload.
 * Keys:
 * - `GUIMessage` -- (Required) -- A {@link GUIMessage} object, which has properties:
 *     - `title` -- (Optional) -- `string`
 *     - `messages`-- (Required) -- `string[] | string`
 *     - `severity` -- (Required) -- `"success" | "info" | "warning" | "error";`
 * - `payload` -- (Required) -- inferred; default is `any`
 */
export interface GUIMessageWithPayload<T = any> {
  GUIMessage: GUIMessage;
  payload: T;
}

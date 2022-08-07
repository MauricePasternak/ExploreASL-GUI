/**
 * This declaration file allows the program to understand the structure of the preload API.
 *
 * @example
 * ```ts
 * const { api } = window;
 * // You can now access api methods like api.invoke() or api.on()
 * ```
 */

import ApplicationProgramInterface from "../../../preload";
declare global {
  interface Window {
    api: typeof ApplicationProgramInterface;
  }
}

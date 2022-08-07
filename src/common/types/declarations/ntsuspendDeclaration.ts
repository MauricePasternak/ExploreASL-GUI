/**
 * This declaration file allows the program to anticipate the ntsuspend package being imported, even if it isn't
 * used in the project, as it cannot be added by npm/yarn on a non-Windows system.
 */

declare module "ntsuspend" {
  function suspend(pid: number): boolean;
  function resume(pid: number): boolean;
}

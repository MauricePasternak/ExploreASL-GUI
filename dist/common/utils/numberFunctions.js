import { floor as lodashFloor, divide as lodashDivide } from "lodash";
/**
 * Calculates a percentage of a number.
 * @param value The current numeric value.
 * @param total A number representing the maximum value.
 * @param ndecimals The number of decimal places to return.
 * @returns The percentage of the current value compared to the total value.
 */
export function calculatePercent(value, total, ndecimals = 2) {
    return lodashFloor(lodashDivide(value, total), ndecimals);
}
//# sourceMappingURL=numberFunctions.js.map
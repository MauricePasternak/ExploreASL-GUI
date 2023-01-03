export const range = (min, max) => [...Array(max - min + 1).keys()].map(i => i + min);
/**
 * Converts an empty array into a null value.
 * @param arr Array to be assessed.
 * @returns `null` is the Array is empty, otherwise the Array is returned.
 */
export const emptyArrayToNull = (arr) => (arr.length === 0 ? null : arr);
/**
 * Rotates a 2D array by 90 degrees amounts in a counter-clockwise direction.
 */
export function rot90(matrix, nrot = 1) {
    const num_turns = (nrot - 1) % 4;
    switch (num_turns) {
        case 0:
            return matrix[0].map((_, i) => [...matrix].map(row => row[row.length - 1 - i]));
        case 1:
            return [...matrix].reverse().map(row => row.reverse());
        case 2:
            return matrix[0].map((_, i) => [...matrix].map(row => row[i]).reverse());
        default:
            return [...matrix];
    }
}
/**
 * Rotates a 3D array by 90 degrees amounts in a counter-clockwise direction with a given axis being the rotation.
 * @param arr3d 3D array to rotate
 * @param nrot The number of rotations to perform.
 * @param frozen_axis Which axis is the axis of rotation.
 * @returns A copy of the array, but rotated accordingly.
 */
export function rot3D90(arr3d, nrot, frozen_axis) {
    switch (frozen_axis) {
        case 0:
            return arr3d.map(arr2d => rot90(arr2d, nrot));
        case 1: {
            const new3DArr = [];
            for (let i = 0; i < arr3d[0][0].length; i++) {
                const newMatrix = [];
                for (let j = 0; j < arr3d.length; j++) {
                    const currMatrix = arr3d[j];
                    // console.log(currMatrix);
                    const newRow = [...currMatrix].reverse().map(row => row[row.length - 1 - i]);
                    // console.log(newRow);
                    newMatrix.push(newRow);
                }
                new3DArr.push(newMatrix);
            }
            return new3DArr.map(arr2d => rot90(arr2d, nrot));
        }
        // return new3DArr;
        case 2: {
            const new3DArr2 = [];
            for (let i = 0; i < arr3d[0].length; i++) {
                const lastI = arr3d[0].length - 1 - i;
                const newMatrix = [];
                for (let j = 0; j < arr3d[0][0].length; j++) {
                    // const lastJ = arr3d.length - 1 - j;
                    const newRow = [];
                    for (let k = 0; k < arr3d.length; k++) {
                        const lastK = arr3d.length - 1 - k;
                        // console.log(lastK, lastI, j);
                        newRow.push(arr3d[lastK][lastI][j]);
                    }
                    newMatrix.push(newRow);
                }
                new3DArr2.push(newMatrix);
            }
            return new3DArr2.map(arr2d => rot90(arr2d, nrot));
        }
        default:
            return arr3d;
    }
}
/**
 * Creates a range of numbers based on the given start, step, and number of steps.
 * @param start The first value in the array
 * @param step The stepsize between values
 * @param nsteps The number of steps
 * @returns An array of numbers of length nsteps
 */
export function arithmeticArray(start, step, nsteps) {
    const result = [];
    for (let i = 0; i < nsteps; i++) {
        result.push(start + i * step);
    }
    return result;
}
/**
 * Converts a 1D array into a 2D array. Does not mutate the original array.
 * @param arr The flat array to be converted into a 2D array.
 * @param nCols The number of columns in the 2D array.
 * @returns The 2D array.
 */
export function matrixify(arr, nCols) {
    const result = [];
    for (let i = 0; i < arr.length; i += nCols) {
        result.push(arr.slice(i, i + nCols));
    }
    return result;
}
/**
 * Pretty-prints a 2D array.
 * @param mat The matrix to be printed.
 */
export function matprint(mat) {
    let shape = [mat.length, mat[0].length];
    function col(mat, i) {
        return mat.map(row => row[i]);
    }
    let colMaxes = [];
    for (let i = 0; i < shape[1]; i++) {
        colMaxes.push(Math.max.apply(null, col(mat, i).map(n => n.toString().length)));
    }
    mat.forEach(row => {
        console.log.apply(null, row.map((val, j) => {
            return new Array(colMaxes[j] - val.toString().length + 1).join(" ") + val.toString() + "";
        }));
    });
}
/**
 * Returns an array of equally-spaced values between the given min and max, inclusive.
 * @param start The first value in the array.
 * @param end The last value in the array.
 * @param nSteps The number of elements that should be in the array, start & end included.
 * @returns An array of numbers of length nsteps with equal spacing between the elements.
 */
export function linspace(start, end, nSteps) {
    const arr = [];
    const step = (end - start) / (nSteps - 1);
    for (let i = 0; i < nSteps; i++) {
        arr.push(start + i * step);
    }
    return arr;
}
/**
 * Gets the minimum, maximum, count, and sum of an array of numbers, ignoring NaN values.
 * @param arr The array of numbers to assess.
 * @returns A tuple of [min, max, count, sum].
 */
export function getMinMaxCountSum(arr) {
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    let count = 0;
    let sum = 0;
    for (const n of arr) {
        if (Number.isNaN(n))
            continue;
        min = Math.min(min, n);
        max = Math.max(max, n);
        count++;
        sum += n;
    }
    return [min, max, count, sum];
}
//# sourceMappingURL=arrayFunctions.js.map
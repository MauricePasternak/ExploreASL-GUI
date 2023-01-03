import { memoize, range as lodashRange, range } from "lodash";
import { arithmeticArray } from "./arrayFunctions";
/**
 *
 * @param niftiData The nifti data to index as a flat numerical array
 * @param differenceSet An array of numbers that represent cases where the indices should backtrack by `subtractValue`
 * @param nSlices The number of slices in the nifti data along the axis of interest.
 * @param initialIndexValues An array of numbers equal to the number of slices that represent the first indexer positions of each slice.
 * @param nCols The number of columns in the expected output.
 * @param nRows The number of rows in the expected output.
 * @param addValue The value to add to the indexer when moving forward in most cases.
 * @param subtractValue The value to subtract from the indexer when moving backward in most cases.
 */
export function niftiToNivo(niftiData, differenceSet, nSlices, initialIndexValues, nCols, nRows, addValue, subtractValue
// TODO: add support for an atlas like MNI_Structural being used to index additional data when appending to rowData
) {
    const result = [];
    for (let sliceIndex = 0; sliceIndex < nSlices; sliceIndex++) {
        const sliceInitialIndexerValue = initialIndexValues[sliceIndex];
        let currentIndexerValue = sliceInitialIndexerValue;
        let elementIndex = 0;
        const nivoSliceDataRows = lodashRange(nRows).map(rowIdx => {
            // Prepare each row
            const rowData = { id: rowIdx.toString(), data: [] };
            for (let colIdx = 0; colIdx < nCols; colIdx++) {
                rowData.data.push({ x: colIdx.toString(), y: niftiData[currentIndexerValue] });
                // Update the indexer value and the current element index
                currentIndexerValue = differenceSet.has(elementIndex)
                    ? currentIndexerValue - subtractValue
                    : currentIndexerValue + addValue;
                elementIndex++;
            }
            return rowData;
        });
        result.push(nivoSliceDataRows);
    }
    return result;
}
/**
 * Reorientates a nifti flat array into the axial orientation.
 * @returns The indexer array necessary to orientate the nifti data into the axial format
 */
function getAxialIndexerBase() {
    // This produces a sagittal slice...
    // const subtractionIndices = new Set(arithmeticArray(119, 121, 144));
    // const firstValuesOfEachSlice = arithmeticArray(17424, 1, 121);
    // const addValue = 17545;
    // const subtractValue = 2105521;
    const subtractionIndices = new Set();
    const firstValuesOfEachSlice = arithmeticArray(17544, 17545, 121);
    const addValue = -1;
    const subtractValue = 0;
    const nCols = 121;
    const nRows = 145;
    const axialFlat = firstValuesOfEachSlice.flatMap(firstValue => {
        let currentValue = firstValue;
        const result = [];
        for (let elementIndex = 0; elementIndex < nRows * nCols; elementIndex++) {
            result.push(currentValue);
            // subtractionIndices.has(elementIndex) ? (currentValue -= subtractValue) : (currentValue += addValue);
            currentValue -= 1;
        }
        return result;
    });
    return axialFlat;
}
export function niftiToNivoAxialAlt(niftiData) {
    const nCols = 121;
    const nRows = 145;
    const nSlices = 121;
    const reslicedData = getAxialIndexer().map(v => niftiData[v]);
    const nivoAxial = range(nSlices).map(sliceIndex => {
        const slice = reslicedData.splice(0, nCols * nRows);
        let elementIndex = 0;
        const sliceData = range(nRows).map(rowIdx => {
            const rowData = { id: rowIdx.toString(), data: [] };
            for (let colIdx = 0; colIdx < nCols; colIdx++) {
                rowData.data.push({ x: colIdx.toString(), y: isNaN(slice[elementIndex]) ? 0 : slice[elementIndex] });
                elementIndex++;
            }
            return rowData;
        });
        return sliceData;
    });
    return nivoAxial;
}
/**
 * O(n) approach to reorientating a nifti flat array into a NivoHeatMap format for axial slices.
 * @param niftiData The nifti data to index as a flat numerical array
 * @returns A tuple of the nifti data formatted for NivoHeatMap, the minimum non-NaN value, and the maximum non-NaN value
 */
export function niftiToNivoAxial(niftiData) {
    const nCols = 121;
    const nRows = 145;
    const nSlices = 121;
    const firstValuesOfEachSlice = arithmeticArray(17544, 17545, 121);
    const differenceWithin = -1;
    const data = [];
    let nanMax = Number.NEGATIVE_INFINITY;
    let nanMin = Number.POSITIVE_INFINITY;
    for (let sliceIndex = 0; sliceIndex < nSlices; sliceIndex++) {
        const sliceInitialIndexerValue = firstValuesOfEachSlice[sliceIndex];
        let currentIndexerValue = sliceInitialIndexerValue;
        // let elementIndex = 0; For axial, we don't need element index
        const nivoSliceDataRows = range(nRows).map(rowIdx => {
            // Prepare each row
            const rowData = { id: rowIdx.toString(), data: [] };
            for (let colIdx = 0; colIdx < nCols; colIdx++) {
                const niftiValue = niftiData[currentIndexerValue];
                rowData.data.push({ x: colIdx.toString(), y: niftiValue });
                currentIndexerValue += differenceWithin;
                if (!isNaN(niftiValue)) {
                    // rowData.data.push({ x: colIdx.toString(), y: 0 });
                    nanMax = Math.max(nanMax, niftiValue);
                    nanMin = Math.min(nanMin, niftiValue);
                    // elementIndex++;
                }
            }
            return rowData;
        });
        data.push(nivoSliceDataRows);
    }
    return [data, nanMin, nanMax];
}
function getCoronalIndexerBase() {
    const subtractionIndices = new Set(arithmeticArray(118, 121, 120));
    const firstValuesOfEachSlice = arithmeticArray(2105520, 121, 145);
    const addValue = -1;
    const subtractValue = 17425;
    const nCols = 121;
    const nRows = 121;
    const coronalFlat = firstValuesOfEachSlice.flatMap(firstValue => {
        let currentValue = firstValue;
        const result = [];
        for (let elementIndex = 0; elementIndex < nRows * nCols; elementIndex++) {
            result.push(currentValue);
            subtractionIndices.has(elementIndex) ? (currentValue -= subtractValue) : (currentValue += addValue);
        }
        return result;
    });
    return coronalFlat;
}
export function niftiToNivoCoronalAlt(niftiData) {
    const nCols = 121;
    const nRows = 121;
    const nSlices = 145;
    const reslicedData = getCoronalIndexer().map(v => niftiData[v]);
    const nivoCoronal = range(nSlices).map(sliceIndex => {
        const slice = reslicedData.splice(0, nCols * nRows);
        let elementIndex = 0;
        const sliceData = range(nRows).map(rowIdx => {
            const rowData = { id: rowIdx.toString(), data: [] };
            for (let colIdx = 0; colIdx < nCols; colIdx++) {
                rowData.data.push({ x: colIdx.toString(), y: isNaN(slice[elementIndex]) ? 0 : slice[elementIndex] });
                elementIndex++;
            }
            return rowData;
        });
        return sliceData;
    });
    return nivoCoronal;
}
export function niftiToNivoCoronal(niftiData) {
    const nCols = 121;
    const nRows = 121;
    const nSlices = 145;
    const subtractionIndices = new Set(arithmeticArray(118, 121, 120));
    const firstValuesOfEachSlice = arithmeticArray(2105520, 121, 145);
    const addValue = -1;
    const subtractValue = 17425;
    const data = [];
    for (let sliceIndex = 0; sliceIndex < nSlices; sliceIndex++) {
        const sliceInitialIndexerValue = firstValuesOfEachSlice[sliceIndex];
        let currentIndexerValue = sliceInitialIndexerValue;
        let elementIndex = 0;
        const nivoSliceDataRows = range(nRows).map(rowIdx => {
            // Prepare each row
            const rowData = { id: rowIdx.toString(), data: [] };
            for (let colIdx = 0; colIdx < nCols; colIdx++) {
                const niftiValue = niftiData[currentIndexerValue];
                rowData.data.push({ x: colIdx.toString(), y: niftiValue });
                subtractionIndices.has(elementIndex)
                    ? (currentIndexerValue -= subtractValue)
                    : (currentIndexerValue += addValue);
                elementIndex++;
            }
            return rowData;
        });
        data.push(nivoSliceDataRows);
    }
    return data;
}
function getSagittalIndexerBase() {
    const firstValuesOfEachSlice = arithmeticArray(2122824, 1, 121);
    const addValue = -121;
    const nCols = 145;
    const nRows = 121;
    const sagittalFlat = firstValuesOfEachSlice.flatMap(firstValue => {
        let currentValue = firstValue;
        const result = [];
        for (let elementIndex = 0; elementIndex < nRows * nCols; elementIndex++) {
            result.push(currentValue);
            currentValue += addValue;
        }
        return result;
    });
    return sagittalFlat;
}
export function niftiToNivoSagittalAlt(niftiData) {
    const nCols = 145;
    const nRows = 121;
    const nSlices = 121;
    const reslicedData = getSagittalIndexer().map(v => niftiData[v]);
    const nivoSagittal = range(nSlices).map(sliceIndex => {
        const slice = reslicedData.splice(0, nCols * nRows);
        let elementIndex = 0;
        const sliceData = range(nRows).map(rowIdx => {
            const rowData = { id: rowIdx.toString(), data: [] };
            for (let colIdx = 0; colIdx < nCols; colIdx++) {
                rowData.data.push({ x: colIdx.toString(), y: isNaN(slice[elementIndex]) ? 0 : slice[elementIndex] });
                elementIndex++;
            }
            return rowData;
        });
        return sliceData;
    });
    return nivoSagittal;
}
export function niftiToNivoSagittal(niftiData) {
    const nCols = 145;
    const nRows = 121;
    const nSlices = 121;
    const firstValuesOfEachSlice = arithmeticArray(2122824, 1, 121);
    const differenceWithin = -121;
    const data = [];
    for (let sliceIndex = 0; sliceIndex < nSlices; sliceIndex++) {
        const sliceInitialIndexerValue = firstValuesOfEachSlice[sliceIndex];
        let currentIndexerValue = sliceInitialIndexerValue;
        // let elementIndex = 0; For sagittal, we don't need element index
        const nivoSliceDataRows = range(nRows).map(rowIdx => {
            // Prepare each row
            const rowData = { id: rowIdx.toString(), data: [] };
            for (let colIdx = 0; colIdx < nCols; colIdx++) {
                const niftiValue = niftiData[currentIndexerValue];
                rowData.data.push({ x: colIdx.toString(), y: niftiValue });
                currentIndexerValue += differenceWithin;
                // elementIndex++;
            }
            return rowData;
        });
        data.push(nivoSliceDataRows);
    }
    return data;
}
const getAxialIndexer = memoize(getAxialIndexerBase);
const getCoronalIndexer = memoize(getCoronalIndexerBase);
const getSagittalIndexer = memoize(getSagittalIndexerBase);
//# sourceMappingURL=nivoFunctions.js.map
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { fromFileSync } from "nifti-stream";
import Path from "pathlib-js";
function toArrayBuffer(buffer) {
    let ab, view, i;
    ab = new ArrayBuffer(buffer.length);
    view = new Uint8Array(ab);
    for (i = 0; i < buffer.length; i += 1) {
        view[i] = buffer[i];
    }
    return ab;
}
export function loadNiftiFile(filepath) {
    return new Promise((resolve, reject) => {
        let head;
        let dimensionality;
        let X;
        let Y;
        let nSlices;
        let nVolumes;
        let bufferSlices = [];
        let data = [];
        // let data: Record<number, DataPoint[]>;
        fromFileSync(filepath)
            .onNiftiHeader(header => {
            // header contains the attributes
            head = header;
            dimensionality = head.dim[0];
            X = head.dim[1];
            Y = head.dim[2];
            nSlices = head.dim[3];
            nVolumes = head.dim[4];
            // console.log(head);
        })
            .onVolumeStream(volume => {
            volume
                .onSlice((sliceNumber, dataAsBuffer) => {
                bufferSlices.push(dataAsBuffer);
            })
                .on("end", () => {
                const singleBuffer = Buffer.concat(bufferSlices);
                // let asNJArray: nj.NdArray<number>;
                switch (head.datatype) {
                    case 2: // NIFTI1.TYPE_UINT8
                        // asNJArray = nj.array(Array.from(new Uint8Array(toArrayBuffer(singleBuffer))));
                        data = Array.from(new Uint8Array(toArrayBuffer(singleBuffer)));
                        break;
                    case 4: // NIFTI1.TYPE_INT16
                        // asNJArray = nj.array(Array.from(new Int16Array(toArrayBuffer(singleBuffer))));
                        data = Array.from(new Int16Array(toArrayBuffer(singleBuffer)));
                        break;
                    case 8: // NIFTI1.TYPE_INT32
                        // asNJArray = nj.array(Array.from(new Int32Array(toArrayBuffer(singleBuffer))));
                        data = Array.from(new Int32Array(toArrayBuffer(singleBuffer)));
                        break;
                    case 16: // NIFTI1.TYPE_FLOAT32
                        // asNJArray = nj.array(Array.from(new Float32Array(toArrayBuffer(singleBuffer))));
                        data = Array.from(new Float32Array(toArrayBuffer(singleBuffer)));
                        break;
                    case 32: // NIFTI1.TYPE_COMPLEX64
                        reject("Complex64 Types are not supported");
                    case 64: // NIFTI1.TYPE_FLOAT64
                        // asNJArray = nj.array(Array.from(new Float64Array(toArrayBuffer(singleBuffer))));
                        data = Array.from(new Float64Array(toArrayBuffer(singleBuffer)));
                        break;
                    case 256: // NIFTI1.TYPE_INT8
                        // asNJArray = nj.array(Array.from(new Int8Array(toArrayBuffer(singleBuffer))));
                        data = Array.from(new Int8Array(toArrayBuffer(singleBuffer)));
                        break;
                    case 512: // NIFTI1.TYPE_UINT16
                        // asNJArray = nj.array(Array.from(new Uint16Array(toArrayBuffer(singleBuffer))));
                        data = Array.from(new Uint16Array(toArrayBuffer(singleBuffer)));
                        break;
                    case 768: // NIFTI1.TYPE_UINT32
                        // asNJArray = nj.array(Array.from(new Uint32Array(toArrayBuffer(singleBuffer))));
                        data = Array.from(new Uint32Array(toArrayBuffer(singleBuffer)));
                        break;
                    case 1024: // NIFTI1.TYPE_INT64
                        // asNJArray = nj.array(
                        //   Array.from(new BigInt64Array(toArrayBuffer(singleBuffer)))
                        // ) as unknown as nj.NdArray<number>;
                        data = Array.from(new BigInt64Array(toArrayBuffer(singleBuffer)));
                        break;
                    case 1280: // NIFTI1.TYPE_UINT64
                        // asNJArray = nj.array(
                        //   Array.from(new BigUint64Array(toArrayBuffer(singleBuffer)))
                        // ) as unknown as nj.NdArray<number>;
                        data = Array.from(new BigUint64Array(toArrayBuffer(singleBuffer)));
                        break;
                    default:
                        reject("Could not read the datatype from the Nifti File.");
                }
                // const tempdata = asNJArray.reshape(X, Y, nSlices) as nj.NdArray<number[][]>;
                // data = tempdata.tolist().reduce((acc, currentValue, idx) => {
                //   acc[idx] = arrToHeatmapData(currentValue);
                //   return acc;
                // }, {} as Record<number, ReturnType<typeof arrToHeatmapData>>);
                resolve({ head, data, dimData: { dimensionality, X, Y, nSlices, nVolumes } });
            });
        });
    });
}
function arrToHeatmapData(arr) {
    const nestedData = arr.flatMap((rowVec, rowIdx) => rowVec.map((colVal, colIdx) => ({
        x: rowIdx,
        y: colIdx,
        value: colVal || 0,
    })));
    return nestedData;
}
export const handleLoadNifti = (event, filepath) => __awaiter(void 0, void 0, void 0, function* () {
    const niftiFilepath = new Path(filepath);
    console.log(`Loading Nifti File: ${niftiFilepath.basename}`);
    if (!(yield niftiFilepath.exists()) || !niftiFilepath.suffixes.includes(".nii")) {
        return false;
    }
    const nifti = yield loadNiftiFile(filepath);
    return nifti.data;
});
//# sourceMappingURL=niftiFuncs.js.map
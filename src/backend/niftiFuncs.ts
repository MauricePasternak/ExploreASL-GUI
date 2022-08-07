import { IpcMainEvent } from "electron";
import { fromFileSync, NiftiHeader } from "nifti-stream";
import Path from "pathlib-js";

type DataPoint = {
  x: number;
  y: number;
  value: number;
};

function toArrayBuffer(buffer: Buffer) {
  let ab, view, i;
  ab = new ArrayBuffer(buffer.length);
  view = new Uint8Array(ab);
  for (i = 0; i < buffer.length; i += 1) {
    view[i] = buffer[i];
  }
  return ab;
}

export function loadNiftiFile(filepath: string): Promise<{
  head: NiftiHeader;
  data: number[];
  // data: Record<number, DataPoint[]>;
  dimData: { dimensionality: number; X: number; Y: number; nSlices: number; nVolumes: number };
}> {
  return new Promise((resolve, reject) => {
    let head: NiftiHeader;
    let dimensionality: number;
    let X: number;
    let Y: number;
    let nSlices: number;
    let nVolumes: number;
    let bufferSlices: Buffer[] = [];
    let data: number[] = [];
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
                data = Array.from(new BigInt64Array(toArrayBuffer(singleBuffer))) as unknown as number[];
                break;
              case 1280: // NIFTI1.TYPE_UINT64
                // asNJArray = nj.array(
                //   Array.from(new BigUint64Array(toArrayBuffer(singleBuffer)))
                // ) as unknown as nj.NdArray<number>;
                data = Array.from(new BigUint64Array(toArrayBuffer(singleBuffer))) as unknown as number[];
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

function arrToHeatmapData(arr: number[][]) {
  const nestedData: DataPoint[] = arr.flatMap((rowVec, rowIdx) =>
    rowVec.map((colVal, colIdx) => ({
      x: rowIdx,
      y: colIdx,
      value: colVal || 0,
    }))
  );
  return nestedData;
}

export const handleLoadNifti = async (event: IpcMainEvent, filepath: string) => {
  const niftiFilepath = new Path(filepath);
  console.log(`Loading Nifti File: ${niftiFilepath.basename}`);
  if (!(await niftiFilepath.exists()) || !niftiFilepath.suffixes.includes(".nii")) {
    return false;
  }
  const nifti = await loadNiftiFile(filepath);
  return nifti.data;
};

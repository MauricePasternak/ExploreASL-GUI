var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __asyncValues = (this && this.__asyncValues) || function (o) {
    if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
    var m = o[Symbol.asyncIterator], i;
    return m ? m.call(o) : (o = typeof __values === "function" ? __values(o) : o[Symbol.iterator](), i = {}, verb("next"), verb("throw"), verb("return"), i[Symbol.asyncIterator] = function () { return this; }, i);
    function verb(n) { i[n] = o[n] && function (v) { return new Promise(function (resolve, reject) { v = o[n](v), settle(resolve, reject, v.done, v.value); }); }; }
    function settle(resolve, reject, d, v) { Promise.resolve(v).then(function(v) { resolve({ value: v, done: d }); }, reject); }
};
import Path from "pathlib-js";
export function getFilepathChildren(filepath, children) {
    return __awaiter(this, void 0, void 0, function* () {
        const fp = new Path(filepath);
        if (Array.isArray(children)) {
            return yield Promise.all(children.map((child) => fp.containsImmediateChild(child)));
        }
        const result = yield fp.containsImmediateChild(children);
        return result;
    });
}
/**
 * Wrapper for determining whether the filepath is a file, directory, other, or non-existent.
 * @param filePath Filepath to be assessed.
 * @returns One of "dir", "file", "other", or false if the filepath does not exist.
 */
export function getFilepathType(filePath) {
    return __awaiter(this, void 0, void 0, function* () {
        const fp = new Path(filePath);
        const [exists, isDir, isFile] = yield Promise.all([fp.exists(), fp.isDirectory(), fp.isFile()]);
        if (!exists)
            return false;
        if (isDir)
            return "dir";
        if (isFile)
            return "file";
        return "other";
    });
}
export function getTree(filepath) {
    return __awaiter(this, void 0, void 0, function* () {
        const p = new Path(filepath);
        const tree = yield p.tree(false);
        // console.log("Getting tree", tree);
        return tree;
    });
}
/**
 * Wrapper for reading a JSON file while handling the try-catch that comes with bad parsing or invalid JSON filepath.
 * @param filepath JSON Filepath to be read
 * @param options Options for reading the JSON file {@link JsonReadOptions}
 * @returns An object with properties:
 * - `payload` - The JSON object read from the file.
 * - `error` - Either `false` if no error occurred, or a {@link ReadJSONError} object.
 */
export function loadJSONSafe(filepath, options) {
    return __awaiter(this, void 0, void 0, function* () {
        const fp = new Path(filepath);
        const [exists, isFile] = yield Promise.all([fp.exists(), fp.isFile()]);
        if (!exists || !isFile || fp.ext !== ".json")
            return {
                payload: {},
                error: {
                    type: "FileIsNotJSON",
                    message: `File ${fp.path} is not a JSON file.`,
                },
            };
        // Try-catch for loading the file; in the event of a parsing error, return the error.
        try {
            const json = yield fp.readJSON(options);
            return {
                payload: json,
                error: false,
            };
        }
        catch (error) {
            return {
                payload: {},
                error: {
                    type: "ParseError",
                    message: error.message,
                },
            };
        }
    });
}
export function recursiveDelete(filepath) {
    var _a, e_1, _b, _c;
    return __awaiter(this, void 0, void 0, function* () {
        try {
            for (var _d = true, _e = __asyncValues(filepath.readDirIter()), _f; _f = yield _e.next(), _a = _f.done, !_a;) {
                _c = _f.value;
                _d = false;
                try {
                    const childPath = _c;
                    if (yield childPath.isDirectory()) {
                        // Delete all children first
                        yield recursiveDelete(childPath);
                        // Then delete the directory itself
                        console.log("Deleting directory: ", childPath.path);
                        yield childPath.remove();
                    }
                    else {
                        // Files can be deleted immediately
                        console.log("Deleting file: ", childPath.path);
                        yield childPath.remove();
                    }
                }
                finally {
                    _d = true;
                }
            }
        }
        catch (e_1_1) { e_1 = { error: e_1_1 }; }
        finally {
            try {
                if (!_d && !_a && (_b = _e.return)) yield _b.call(_e);
            }
            finally { if (e_1) throw e_1.error; }
        }
    });
}
//# sourceMappingURL=filepathFunctions.js.map
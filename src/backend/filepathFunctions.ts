import { ReadOptions as ReadJSONOptions } from "fs-extra";
import Path, { JSONObject } from "pathlib-js";
import { ReadJSONError } from "../common/types/filepathOperationsTypes";

/**
 * Checks whether a given child/child basename is within the provided parent directory.
 * @param filepath Filepath to be assessed.
 * @param children Either a string or an array of strings of the basenames of the children to be searched for.
 */
export async function getFilepathChildren(filepath: string, children: string): Promise<false | Path>;
export async function getFilepathChildren(filepath: string, children: string[]): Promise<(false | Path)[]>;
export async function getFilepathChildren(
	filepath: string,
	children: string | string[]
): Promise<(false | Path) | (false | Path)[]> {
	const fp = new Path(filepath);
	if (Array.isArray(children)) {
		return await Promise.all(children.map((child) => fp.containsImmediateChild(child)));
	}
	const result = await fp.containsImmediateChild(children);
	return result;
}

/**
 * Wrapper for determining whether the filepath is a file, directory, other, or non-existent.
 * @param filePath Filepath to be assessed.
 * @returns One of "dir", "file", "other", or false if the filepath does not exist.
 */
export async function getFilepathType(filePath: string) {
	const fp = new Path(filePath);
	const [exists, isDir, isFile] = await Promise.all([fp.exists(), fp.isDirectory(), fp.isFile()]);
	if (!exists) return false;
	if (isDir) return "dir";
	if (isFile) return "file";
	return "other";
}

export async function getTree(filepath: string) {
	const p = new Path(filepath);
	const tree = await p.tree(false);
	// console.log("Getting tree", tree);
	return tree;
}

/**
 * Wrapper for reading a JSON file while handling the try-catch that comes with bad parsing or invalid JSON filepath.
 * @param filepath JSON Filepath to be read
 * @param options Options for reading the JSON file {@link ReadJSONOptions}
 * @returns An object with properties:
 * - `payload` - The JSON object read from the file.
 * - `error` - Either `false` if no error occurred, or a {@link ReadJSONError} object.
 */
export async function loadJSONSafe<T extends JSONObject = JSONObject>(
	filepath: string,
	options?: string | ReadJSONOptions
): Promise<{ payload: T; error: ReadJSONError | false }> {
	const fp = new Path(filepath);
	const [exists, isFile] = await Promise.all([fp.exists(), fp.isFile()]);
	if (!exists || !isFile || fp.ext !== ".json")
		return {
			payload: {} as T,
			error: {
				type: "FileIsNotJSON",
				message: `File ${fp.path} is not a JSON file.`,
			},
		};

	// Try-catch for loading the file; in the event of a parsing error, return the error.
	try {
		const json = await fp.readJSON(options);
		return {
			payload: json as T,
			error: false,
		};
	} catch (error) {
		return {
			payload: {} as T,
			error: {
				type: "ParseError",
				message: error.message,
			},
		};
	}
}

export async function recursiveDelete(filepath: Path) {
	for await (const childPath of filepath.readDirIter()) {
		if (await childPath.isDirectory()) {
			// Delete all children first
			await recursiveDelete(childPath);
			// Then delete the directory itself
			console.log("Deleting directory: ", childPath.path);
			await childPath.remove();
		} else {
			// Files can be deleted immediately
			console.log("Deleting file: ", childPath.path);
			await childPath.remove();
		}
	}
}

import React, { useEffect } from "react";
import Path, { treeBranch } from "pathlib-js";
import TreeView, { TreeViewProps } from "@mui/lab/TreeView";
import TreeItem from "@mui/lab/TreeItem";
import { uniqBy as lodashUniqBy, isEmpty as lodashIsEmpty } from "lodash";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import FormControlLabel from "@mui/material/FormControlLabel";
import Checkbox, { CheckboxProps } from "@mui/material/Checkbox";
import { PrimitiveAtom, useAtom } from "jotai";
import { useDebouncedCallback } from "use-debounce";
import { WatchOptions } from "chokidar";
import FastIsEqual from "fast-deep-equal";

export type selectedNodeType = Omit<treeBranch<Path>, "children">;
export type FilepathWatchEvents = "addDir" | "add" | "change" | "unlink" | "unlinkDir";

export interface AtomicFilepathTreeViewProps {
	/**
	 * The path to the directory to display in the tree.
	 */
	rootPath: string;
	/**
	 * The channel with which to communicate with the filepath watcher.
	 */
	watchChannel: string;
	/**
	 * A jotai atom that represents the file structure to display.
	 */
	atomTree: PrimitiveAtom<treeBranch<Path>>;
	/**
	 * A jotai atom that represents the currently selected filepaths.
	 */
	atomSelectedNodes: PrimitiveAtom<selectedNodeType[]>;
	/**
	 * Additional props to pass to the TreeView component.
	 */
	TreeViewProps?: TreeViewProps;
	/**
	 * Additional props to pass to the Checkbox component of each TreeItem.
	 */
	CheckboxProps?: CheckboxProps;
	/**
	 * Additional options to pass to the chokidar watcher.
	 */
	watchOptions?: WatchOptions;
	/**
	 * Chokidar watcher events to respond to.
	 * @default Defaults to "addDir", "add", "change", "unlink", and "unlinkDir".
	 */
	eventsToRespondTo?: FilepathWatchEvents[];
}

/**
 * A modified version of Material UI's TreeView component that watches a filepath and renders the tree accordingly.
 * The follow behaviors are notable:
 * - The tree is initially rendered with the root node expanded.
 * - Selecting a node automatically selects all of its children.
 * - The tree is updated when the filepath watcher detects a change in the underlying file structure.
 * Props are documented in {@link AtomicFilepathTreeViewProps}.
 */
export const AtomicFilepathTreeView = React.memo(
	({
		watchChannel,
		rootPath,
		atomTree,
		atomSelectedNodes,
		TreeViewProps,
		CheckboxProps,
		watchOptions,
		eventsToRespondTo = ["addDir", "add", "change", "unlink", "unlinkDir"],
	}: AtomicFilepathTreeViewProps) => {
		if (!rootPath) throw new Error("rootPath is required");
		if (!watchChannel) {
			watchChannel = rootPath;
		}
		const { api } = window;
		const [tree, setTree] = useAtom(atomTree);
		const [selectedNodes, setSelectedNodes] = useAtom(atomSelectedNodes);

		/**
		 * Handler for fetching a new tree structure.
		 * @param resetSelectedNodes If true, the selected nodes will be reset back to an empty array.
		 */
		async function updateTree(resetSelectedNodes = true) {
			const fetchedTree = await api.path.getTree(rootPath);
			setTree(fetchedTree);
			if (resetSelectedNodes) {
				setSelectedNodes([]);
			}
		}

		const debouncedUpdateTree = useDebouncedCallback(updateTree, 500);

		useEffect(() => {
			async function initializeWatcher() {
				const filePathExists = await api.path.filepathExists(rootPath);
				if (!filePathExists) return;
				await api.invoke("FSWatcher:Initialize", watchChannel, rootPath, watchOptions);

				api.on(`${watchChannel}:FSWatcherEvent`, async (event) => {
					if (!eventsToRespondTo.includes(event)) return;
					await debouncedUpdateTree(true);
				});
			}
			initializeWatcher();

			// Cleanup:
			// 1) Must tell backend to stop watching the rootPath and remove it from the global watcher list
			// 2) Must remove the event listener for the api
			return () => {
				async function stopWatcher() {
					const foo = await api.invoke("FSWatcher:Shutdown", rootPath);
					if (!foo) console.error("Failed to shut down watcher");
				}
				stopWatcher();
				api.removeAllListeners(`${watchChannel}:FSWatcherEvent`);
			};
		}, [rootPath, watchChannel, JSON.stringify(eventsToRespondTo)]);

		/**
		 * Resurive function for retrieving a node by matching its filepath property against a target path.
		 * @param node The node that is to be searched.
		 * @param path The path to check against that node's filepath property.
		 * @returns Returns `null` if the node and none of its children match the path. Otherwise, returns the node or the
		 * child that matches the path.
		 */
		function getNodeByPath(node: treeBranch<Path>, path: string) {
			// If found, return the node.
			if (node.filepath.path === path) return node;
			// If the node is a file, return null.
			if (node.children == null || node.children.length <= 0) return null;
			// Otherwise, recursively search for the node.
			let result: null | treeBranch<Path> = null; // Start by assuming the node is not found.
			node.children.forEach((child) => {
				const temp = getNodeByPath(child, path);
				if (temp != null) {
					result = temp;
				}
			});
			return result;
		}

		/**
		 * Retrieves all the children of a node that matches a given filepath
		 */
		function getNodeChildrenByPath(node: treeBranch<Path>, path: string) {
			let nodeArray: selectedNodeType[] = [];

			function getNodeChildren(node: treeBranch<Path> | null) {
				// If the node is not existant, return an empty array.
				if (node == null) return [];
				nodeArray.push({ filepath: node.filepath, depth: node.depth });

				// If the node is a file, return the nodeArray accumilated thus far.
				if (!Array.isArray(node.children)) return nodeArray;

				// Otherwise, recursively add onto the nodeArray.
				node.children.forEach((child) => {
					nodeArray = [...nodeArray, ...getNodeChildren(child)];
					// Filter out duplicate nodes on the basis of filepath.
					nodeArray = lodashUniqBy(nodeArray, "filepath");
				});
				return nodeArray;
			}
			return getNodeChildren(getNodeByPath(node, path));
		}

		function handleCheck(checked: boolean, node: treeBranch<Path>) {
			const nodeAndItsChildrenArray = getNodeChildrenByPath(tree, node.filepath.path);
			const filepathsArray = nodeAndItsChildrenArray.map((node) => node.filepath.path);

			const newSelectedNodes = checked
				? // If the node is checked, add it and its children to the selectedNodes array.
				  lodashUniqBy([...selectedNodes, ...nodeAndItsChildrenArray], "filepath")
				: // If the node is unchecked, remove it and its children from the selectedNodes array.
				  selectedNodes.filter((node) => !filepathsArray.includes(node.filepath.path));
			setSelectedNodes(newSelectedNodes);
		}

		function renderTreeBranch(node: treeBranch<Path>) {
			const hasChildren = Array.isArray(node.children) && node.children.length > 0;
			const isChecked = selectedNodes.some((selectedNode) => selectedNode.filepath.path === node.filepath.path);

			return (
				<TreeItem
					key={node.filepath.path}
					nodeId={node.depth < 1 ? "expandme" : node.filepath.path}
					label={
						<FormControlLabel
							label={node.filepath.basename}
							control={
								<Checkbox
									{...CheckboxProps}
									checked={isChecked}
									onChange={(_, checked) => handleCheck(checked, node)}
									onClick={(e) => e.stopPropagation()}
								/>
							}
						/>
					}
				>
					{hasChildren ? node.children.map((child) => renderTreeBranch(child)) : null}
				</TreeItem>
			);
		}

		return (
			<TreeView
				defaultCollapseIcon={<ExpandMoreIcon />}
				defaultExpandIcon={<ChevronRightIcon />}
				defaultExpanded={["expandme"]}
				{...TreeViewProps}
			>
				{lodashIsEmpty(tree) && rootPath ? null : renderTreeBranch(tree)}
			</TreeView>
		);
	},
	FastIsEqual
);

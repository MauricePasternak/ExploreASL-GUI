import Card from "@mui/material/Card";
import CardHeader from "@mui/material/CardHeader";
import React from "react";
import FolderIcon from "@mui/icons-material/Folder";
import Avatar from "@mui/material/Avatar";
import Divider from "@mui/material/Divider";
import CardContent from "@mui/material/CardContent";
import Grid from "@mui/material/Grid";
import { DebouncedFilepathInput } from "../../components/DebouncedComponents";
import { useAtom } from "jotai";
import { atomPreferredExploreASLPath, atomPreferredMATLABRuntimePath } from "../../stores/GlobalSettingsStore";

export function PreferredPathsSettings() {
	const [preferredEASLPath, setPreferredEASLPath] = useAtom(atomPreferredExploreASLPath);
	const [preferredMATLABRuntimePath, setPreferredMATLABRuntimePath] = useAtom(atomPreferredMATLABRuntimePath);

	return (
		<Card>
			<CardHeader
				title="Preferred Filepaths Settings"
				titleTypographyProps={{ variant: "h4" }}
				subheader="Autopopulate certain filepath fields found throughout the software on next startup"
				avatar={
					<Avatar>
						<FolderIcon />
					</Avatar>
				}
			/>
			<Divider variant="middle" />
			<CardContent>
				<Grid container rowSpacing={2} columnSpacing={3}>
					<Grid item xs={12} lg={6}>
						<DebouncedFilepathInput
							filepathType="dir"
							dialogOptions={{ title: "Select ExploreASL Path", properties: ["openDirectory"] }}
							value={preferredEASLPath}
							label="ExploreASL Path"
							onChange={(newPath) => {
								setPreferredEASLPath(newPath);
							}}
							helperText="The path to the ExploreASL folder (or xASL_latest if you have a compiled version) that contains the ExploreASL executable program"
						/>
					</Grid>
					<Grid item xs={12} lg={6}>
						<DebouncedFilepathInput
							filepathType="dir"
							dialogOptions={{ title: "Select MATLAB Runtime Path", properties: ["openDirectory"] }}
							value={preferredMATLABRuntimePath}
							label="MATLAB Runtime Path"
							onChange={(newPath) => {
								setPreferredMATLABRuntimePath(newPath);
							}}
							helperText="This is the path to the MATLAB Runtime folder whose name is the runtime version (i.e. v96, v97, v912)."
						/>
					</Grid>
				</Grid>
			</CardContent>
		</Card>
	);
}

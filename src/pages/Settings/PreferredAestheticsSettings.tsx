import Card from "@mui/material/Card";
import CardHeader from "@mui/material/CardHeader";
import React from "react";
import MoodIcon from "@mui/icons-material/Mood";
import Avatar from "@mui/material/Avatar";
import Divider from "@mui/material/Divider";
import CardContent from "@mui/material/CardContent";
import Grid from "@mui/material/Grid";
import { useAtom } from "jotai";
import { atomDarkMode } from "../../stores/GlobalSettingsStore";
import ButtonGroup from "@mui/material/ButtonGroup";
import InputLabel from "@mui/material/InputLabel";
import Button from "@mui/material/Button";
import DarkModeSharpIcon from "@mui/icons-material/DarkModeSharp";
import LightModeSharpIcon from "@mui/icons-material/LightModeSharp";
import Typography from "@mui/material/Typography";

export function PreferredAestheticsSettings() {
	const [isDarkMode, setIsDarkMode] = useAtom(atomDarkMode);

	return (
		<Card>
			<CardHeader
				title="Aesthetic Settings"
				titleTypographyProps={{ variant: "h4" }}
				subheader="Change the look and feel of the software"
				avatar={
					<Avatar>
						<MoodIcon />
					</Avatar>
				}
			/>
			<Divider variant="middle" />
			<CardContent>
				<Grid container rowSpacing={2} columnSpacing={3}>
					<Grid item xs={12} lg={6}>
						<InputLabel>Light/Dark Mode</InputLabel>
						<ButtonGroup size="large" sx={{ my: 1 }}>
							<Button
								variant={isDarkMode ? "outlined" : "contained"}
								startIcon={<LightModeSharpIcon />}
								onClick={() => setIsDarkMode(false)}
							>
								Light
							</Button>
							<Button
								variant={isDarkMode ? "contained" : "outlined"}
								startIcon={<DarkModeSharpIcon />}
								onClick={() => setIsDarkMode(true)}
							>
								Dark
							</Button>
						</ButtonGroup>
						<Typography variant="subtitle2">Currently selected: {isDarkMode ? "Dark Mode" : "Light Mode"}</Typography>
					</Grid>
				</Grid>
			</CardContent>
		</Card>
	);
}

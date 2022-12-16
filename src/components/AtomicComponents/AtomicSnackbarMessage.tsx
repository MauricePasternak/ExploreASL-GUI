import React, { memo } from "react";
import { atom, PrimitiveAtom, useAtom } from "jotai";
import Alert, { AlertProps } from "@mui/material/Alert";
import Snackbar, { SnackbarProps } from "@mui/material/Snackbar";
import Typography, { TypographyProps } from "@mui/material/Typography";
import AlertTitle from "@mui/material/AlertTitle";
import IconButton from "@mui/material/IconButton";
import CloseIcon from "@mui/icons-material/Close";
import Box from "@mui/material/Box";
import ErrorOutlineOutlinedIcon from "@mui/icons-material/ErrorOutlineOutlined";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import WarningAmberOutlinedIcon from "@mui/icons-material/WarningAmberOutlined";
import CheckCircleOutlinedIcon from "@mui/icons-material/CheckCircleOutlined";

export type SnackbarMessageExtraDisplayProps = {
	/**
	 * Controls the maximum height of the alert within the snackbar.
	 * @default "450px"
	 */
	maxHeight?: number;
	/**
	 * Controls the size of the close button.
	 * @default "medium"
	 */
	closeIconSize?: "small" | "medium" | "large";
	/**
	 * Controls the color of the icon button.
	 * @default "medium"
	 */
	alertIconSize?: "small" | "medium" | "large";
};

/**
 * Configuration for the AtomicSnackbarMessage component.
 * @property severity - The type of the message. One of "error", "warning", "info", "success".
 * @property title - The title to display.
 * @property message - The message to display.
 */
export interface SnackbarMessageConfig {
	/**
	 * The severity state of the message that is to be displayed. One of "error", "warning", "info", "success".
	 */
	severity: "error" | "info" | "success" | "warning";
	/**
	 * The title of the snackbar alert.
	 */
	title?: string;
	/**
	 * Typography variant to use for the title.
	 */
	titleVariant?: TypographyProps["variant"];
	/**
	 * The message to display. This can be a string, Array of string, a {@link SnackbarMessageType} object
	 */
	message: string | string[] | React.ReactElement | React.ReactElement[];
	/**
	 * Additional display-related properties for the snackbar and/or alert.
	 */
	extraDisplayProps?: SnackbarMessageExtraDisplayProps;
}

export type AtomicSnackbarMessageProps = {
	/**
	 * The configuration for the AtomicSnackbarMessage component.
	 */
	atomConfig: PrimitiveAtom<SnackbarMessageConfig>;
	zIndex?: number;
} & SnackbarProps &
	Pick<AlertProps, "variant">;

/**
 * Modified Snackbar that displays an alert message.
 */
const BaseAtomicSnackbarMessage = ({
	atomConfig,
	variant = "filled",
	zIndex = 1400,
	...snackbarProps
}: AtomicSnackbarMessageProps) => {
	const [config, setConfig] = useAtom(atomConfig);
	const isOpen = !!config.message; // closed when message is an empty string or empty array

	/**
	 * Parses the config message into Typography components.
	 */
	const parseConfigMessage = (message: SnackbarMessageConfig["message"]) => {
		if (Array.isArray(message)) {
			return message.map((msg, idx) => {
				const key = `AtomicSnackbarMessageLine_${idx}`;
				// Array of strings
				if (typeof msg === "string")
					return /^\s+$/gm.test(msg) ? <br key={key} /> : <Typography key={key}>{msg}</Typography>;
				// Array of SnackbarMessageType objects
				return msg;
			});
		} else if (typeof message === "string") {
			return /^\s+$/gm.test(message) ? (
				<br key={`AtomicSnackbarMessageLine`} />
			) : (
				<Typography key={`AtomicSnackbarMessageLine`}>{message}</Typography>
			);
		} else {
			return message;
		}
	};

	return isOpen ? (
		<Snackbar
			open={isOpen}
			autoHideDuration={null}
			onClose={() => setConfig({ ...config, title: "", message: "" })}
			anchorOrigin={{ horizontal: "center", vertical: "bottom" }}
			// Allows for the snackbar to pop up right in the middle of the window
			sx={{
				top: "1rem",
				minWidth: "max(450px, 80%)",
				maxWidth: "80%",
				left: "50%",
				bottom: "24px",
				right: "auto",
				transform: "translateX(-50%)",
				zIndex: zIndex,
			}}
			{...snackbarProps}
		>
			<Alert
				variant={variant}
				severity={config.severity}
				sx={{
					"& .MuiAlert-action": {
						mr: -1.5,
						p: 0,
					},
					width: "100%",
				}}
				iconMapping={{
					error: <ErrorOutlineOutlinedIcon fontSize={config.extraDisplayProps?.alertIconSize ?? "large"} />,
					info: <InfoOutlinedIcon fontSize={config.extraDisplayProps?.alertIconSize ?? "large"} />,
					warning: <WarningAmberOutlinedIcon fontSize={config.extraDisplayProps?.alertIconSize ?? "large"} />,
					success: <CheckCircleOutlinedIcon fontSize={config.extraDisplayProps?.alertIconSize ?? "large"} />,
				}}
				action={
					<IconButton
						aria-label="close"
						color="inherit"
						onClick={() => setConfig({ ...config, title: "", message: "" })} // Closes the snackbar
					>
						<CloseIcon fontSize={config.extraDisplayProps?.closeIconSize ?? "large"} />
					</IconButton>
				}
			>
				<AlertTitle>
					<Typography variant={config.titleVariant ?? "h4"}>{config.title}</Typography>
				</AlertTitle>
				<Box maxHeight={config.extraDisplayProps?.maxHeight ?? "400px"} p={1} sx={{ overflowY: "auto" }}>
					{isOpen && parseConfigMessage(config.message)}
				</Box>
			</Alert>
		</Snackbar>
	) : null;
};

export const AtomicSnackbarMessage = React.memo(BaseAtomicSnackbarMessage);

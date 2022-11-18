import { styled } from "@mui/material/styles";
import Box, { BoxProps } from "@mui/material/Box";

export interface OutlinedGroupBoxProps {
  /**
   * The label of the group box.
   */
  label: string;
  /**
   * The fontsize of the label.
   * @default Material UI H6
   */
  labelFontSize?: BoxProps["fontSize"];
  /**
   * The offset of the label relative to the left side of the box.
   * @default 2.25 the spacing of Material UI
   */
  labelLeftOffset?: BoxProps["ml"];
  /**
   * The offset of the label relative to the top side of the box.
   * @default 2.25 the spacing of Material UI
   */
  labelTopOffset?: BoxProps["mt"];
  /**
   * The background color behind the label.
   * @default The background color of the theme
   */
  labelBackgroundColor?: BoxProps["bgcolor"];
}

/**
 * Modified Material UI Box component to feature a hovering label around the top-left corner of the box.
 * Meant to act akin the Qt Groupbox widget (minus the checkable property).
 * @param label The label of the group box.
 * @param labelFontSize The fontsize of the label.
 * @param labelLeftOffset The offset of the label relative to the left side of the box.
 * @param labelTopOffset The offset of the label relative to the top side of the box.
 * @param labelBackgroundColor The background color behind the label.
 * @param props The rest of the props passed to the Box component.
 */
export const OutlinedGroupBox = styled(Box)<OutlinedGroupBoxProps>(
  ({ theme, label, labelFontSize, labelLeftOffset, labelTopOffset, labelBackgroundColor }) => {
    return {
      borderWidth: theme.spacing(0.25),
      borderStyle: "solid",
      borderColor: theme.palette.primary.main,
      borderRadius: theme.shape.borderRadius,
      position: "relative",
      "&:before": {
        paddingLeft: theme.spacing(1),
        paddingRight: theme.spacing(1),
        content: `"${label}"`,
        position: "absolute",
        top: labelTopOffset
          ? typeof labelTopOffset === "function"
            ? labelTopOffset(theme)
            : labelTopOffset
          : `-${theme.spacing(2.25)}`,
        left: labelLeftOffset
          ? typeof labelLeftOffset === "function"
            ? labelLeftOffset(theme)
            : labelLeftOffset
          : theme.spacing(2.25),
        backgroundColor: labelBackgroundColor
          ? typeof labelBackgroundColor === "function"
            ? labelBackgroundColor(theme)
            : labelBackgroundColor
          : theme.palette.background.default,
        fontSize: labelFontSize ?? theme.typography.h6.fontSize,
      },
    };
  }
);

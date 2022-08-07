/**
 * This declaration file allows for the Material UI Theme and Palette to be modified and/or have additional
 * properties added to it.
 *
 * Note that ThemeOptions and PaletteOptions control what is required when using `creatTheme`, while
 * Theme and Palette control what is presented when using the theme instance during use of `styled` or the `sx` prop.
 */

// This import is necessary for module augmentation to work. We briefly disable eslint to avoid a linting error.
/* eslint-disable */
import { Theme, ThemeOptions, Palette, PaletteOptions } from "@mui/material/styles";

/**
 * Adding on extra theme properties
 */
declare module "@mui/material/styles" {
  // This controls what appears when you use the theme variable inside sx, styled, etc.
  interface Theme {
    additionalThemeProperty: string;
  }
  // This controls what you are allowed to specify in `createTheme`.
  interface ThemeOptions {
    additionalThemeProperty: string;
  }
}

/**
 * Adding on extra palette properties
 */
declare module "@mui/material/styles/createPalette" {
  // This controls what appears when you use the theme variable inside sx, styled, etc.
  export interface Palette {
    orange: {
      main: string;
      light: string;
      dark: string;
      contrastText: string;
    };
  }
  // This controls what you are allowed to specify in `createTheme`.
  export interface PaletteOptions {
    orange: {
      main: string;
      light: string;
      dark: string;
      contrastText: string;
    };
  }
  // You need both to get the behavior you want.
}

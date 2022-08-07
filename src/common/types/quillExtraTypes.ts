import { QUILLFONTFAMILIES } from "../GLOBALS";
import { CSSSize } from "./cssTypes";

/**
 * Type representing the format arguement to give to the `format` argument in Quill functions such as `insertText`.
 */
export type QuillFormat = {
  /**
   * Whether the text should be bold.
   */
  bold?: boolean;
  /**
   * Whether the text should be italic.
   */
  italic?: boolean;
  /**
   * Whether the text should be striked out.
   */
  strike?: boolean;
  /**
   * Whether the text should be underlined.
   */
  underline?: boolean;
  /**
   * Whether the text should have a darker background indicating it is a code variable.
   * `Like this`
   */
  code?: boolean;
  /**
   * Whether the code should be superscripted or subscripted.
   */
  script?: "sub" | "super";
  /**
   * The size of the text. By the current implementation, accepts units of `px`, `rem`, and `em`.
   */
  size?: CSSSize;
  /**
   * The color of the text. CSS-compatible color strings are accepted.
   */
  color?: string;
  /**
   * The background color of the text. CSS-compatible color strings are accepted.
   */
  background?: string;
  /**
   * The name of the font family to use. Change the values in the GLOBALS.ts file to suit your needs.
   */
  font?: typeof QUILLFONTFAMILIES[number];
  /**
   * A hyperlink to be applied to the text.
   */
  link?: string;
  /**
   * The inserted text should be treated as a list item.
   */
  list?: "ordered" | "bullet";
};

/**
 * This declaration file allows the program to load image files into the project.
 * @example
 * ```ts
 * import SomeSvg from "../../../assets/images/someSvg.svg";
 * // Note that svg files are automatically loaded as a component.
 * <SomeSvg height={40} />
 *
 *
 * import SomeImage from "../../../assets/images/someImage.png";
 * // Raster images are NOT loaded as components, rather as a blob that can be accessed
 * // with an <img> tag's `src` property.
 * <img src={SomeImage} style={{height: 40}} />
 * ```
 */

declare module "*.svg" {
  const content: any;
  export default content;
}
declare module "*.png";
declare module "*.jpg";
declare module "*.gif";

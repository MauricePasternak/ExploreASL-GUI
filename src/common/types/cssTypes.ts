// SIZE

import { Trim } from "./utilityTypes";

/**
 * Type representing the suffixes related to size
 * @example "px", "em", "rem"
 */
export type CSSSizeSuffixes = "px" | "em" | "rem" | "ch" | "cm" | "mm" | "in" | "%";

/**
 * Type representing a CSS size.
 * @example
 * "6px", "8rem", "1.5em", "1ch", "1cm", "1mm", "1in", "1%"
 */
export type CSSSize = `${number}${CSSSizeSuffixes}`;

// COLOR
export type HexDigit = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "a" | "b" | "c" | "d" | "e" | "f";
export type Hex3 = `${HexDigit}${HexDigit}${HexDigit}`;
/**
 * Type representing a CSS color in hexadecimal format.
 * @example
 * #ff0000, #00ff00, #aa0011
 */
export type HexRGBColor<T extends string> = Lowercase<T> extends `#${Hex3}`
  ? T
  : Lowercase<T> extends `#${Hex3}${infer Rest}`
  ? Rest extends Hex3
    ? T
    : never
  : never;

type Digits0to9 = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9";
type Digits0to4 = "0" | "1" | "2" | "3" | "4";
type Digits0to255 =
  | `${Digits0to9}`
  | `${Digits0to9}${Digits0to9}`
  | `1${Digits0to9}${Digits0to9}`
  | `2${Digits0to9}${Digits0to9}`
  | `2${Digits0to4}${Digits0to9}`
  | `25${Digits0to4 | "5"}`;

type OnlyContainsDigits<T extends string> = T extends `${Digits0to9}${infer Rest}`
  ? Rest extends ""
    ? true
    : OnlyContainsDigits<Rest>
  : never;

type IsFloatOrInteger<T extends string> = T extends `${infer Integer}.${infer Fractional}`
  ? Integer extends ""
    ? // If the integer is empty check the fractional part
      OnlyContainsDigits<Fractional>
    : Fractional extends ""
    ? // If the fractional part is empty, check the integer part
      OnlyContainsDigits<Integer>
    : // Otherwise check if both are valid
      OnlyContainsDigits<Integer> & OnlyContainsDigits<Fractional>
  : // Otherwise this is either a pure integer that will return true or an odd string that will return false
    OnlyContainsDigits<T>;

type IntegerPart<T extends string> = T extends `${infer I}.${infer F}` ? I : T;

type IsInteger<T extends string> = true extends IsFloatOrInteger<T> ? (T extends IntegerPart<T> ? true : false) : false;

type LessThanOrEqualTo100<T extends string> = IsFloatOrInteger<T> extends true
  ? IntegerPart<T> extends `${Digits0to9}` | `${Digits0to9}${Digits0to9}` | "100"
    ? true
    : false
  : false;

type IsPercent<T extends string> = `0` extends T ? true : T extends `${infer P}%` ? LessThanOrEqualTo100<P> : false;

type IsColor255<T extends string> = true extends IsInteger<T> ? (T extends `${Digits0to255}` ? true : false) : false;

type IsColorValue<T extends string> = IsColor255<T> | IsPercent<T>;

type RGB<T extends string> = T extends `rgb(${infer R}, ${infer G}, ${infer B})`
  ? [true, true, true] extends [IsColorValue<Trim<R>>, IsColorValue<Trim<G>>, IsColorValue<Trim<B>>]
    ? T
    : never
  : never;

type Opacity<T extends string> = IsFloatOrInteger<T> | IsPercent<T>;

type RGBA<T extends string> = T extends `rgba(${infer R}, ${infer G}, ${infer B}, ${infer A})`
  ? [true, true, true, true] extends [
      IsColorValue<Trim<R>>,
      IsColorValue<Trim<G>>,
      IsColorValue<Trim<B>>,
      Opacity<Trim<A>>
    ]
    ? T
    : never
  : never;

export type CSSColor<T extends string> = RGB<T> | RGBA<T> | HexRGBColor<T>;

// export type CSSRGBType = `rgb(${number}, ${number}, ${number})`;
// export type CSSRGBAType = `rgba(${ZeroTo255}, ${ZeroTo255}, ${ZeroTo255}, ${ZeroTo255})`;

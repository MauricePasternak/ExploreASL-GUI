/**************************************************************************************************
 * General Types
 *************************************************************************************************/

export type Primitive = string | number | boolean | bigint | symbol | undefined | null;

/**************************************************************************************************
 * Basic String & Regexp-Associated Types
 *************************************************************************************************/

/**
 * Extracts out the second part out of an event name featuring a delimiter (i.e. ":")
 * @example
 * ```
 * ExtractChannelName<"foo:bar">; // "bar"
 * ```
 */
export type ExtractChannelName<
	T extends string,
	Delimiter extends string = ":"
> = T extends `${string}${Delimiter}${infer ChannelName}` ? ChannelName : T;

export type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

type WhiteSpace = " ";
export type Trim<T> = T extends `${WhiteSpace}${infer U}` ? Trim<U> : T extends `${infer U}${WhiteSpace}` ? Trim<U> : T;

type MatchesCaptureGroup<T extends string> = T extends `${string}(?<${string}>${string})${string}` ? true : false;

export type GetCaptureGroup<T extends string> = T extends `${string}(?<${infer G}>${string})${string}` ? [G] : never;

export type ParseCaptureGroup<T extends string> = T extends `${string}(?<${infer G}>${string})${infer Rest}`
	? MatchesCaptureGroup<Rest> extends true
		? [G, ...ParseCaptureGroup<Rest>]
		: [G]
	: [];

type ParseNamedCaptureGroupsImpl<
	PS extends string,
	PT extends string[]
> = PS extends `${string}(?<${infer G}>${infer PossibleNested})${infer Rest}`
	? [
			...ParseNamedCaptureGroupsImpl<Rest, AppendNonBlankString<PT, G>>,
			...ParseNamedCaptureGroupsImpl<`${PossibleNested})`, []>
	  ]
	: PT;

export type ParseNamedCaptureGroups<PS extends string> = ParseNamedCaptureGroupsImpl<PS, []>;

/**************************************************************************************************
 * Basic Array-Associated Types
 *************************************************************************************************/

/**
 * Converts an array into a object where array elements are keys and values are strings.
 * ```
 * ArrToStringMapping<["Foo", "Bar"]> = { Foo: string, Bar: string }
 * ```
 */
export type ArrToStringMapping<T extends readonly any[]> = {
	[K in T[number]]: string;
};

/**
 * Gets the length of an array type.
 */
export type Length<T extends readonly any[]> = T extends { length: infer L } ? L : never;

/**
 * Type to query whether an array type T is a tuple type.
 * @typeParam T - type which may be an array or tuple
 * @example
 * ```
 * IsTuple<[number]> = true
 * IsTuple<number[]> = false
 * ```
 */
export type IsTuple<T extends readonly any[]> = number extends T["length"] ? true : false;

/** Removes the first element from an array. */
export type DropFirstElement<T extends ReadonlyArray<any>> = T extends [any, ...infer Rest]
	? Rest
	: Length<T> extends 0 // If the array is empty, return an empty array
	? []
	: never;

/** Removes the last element from an array. */
export type DropLastElement<T extends ReadonlyArray<any>> = T extends [...infer Rest, any]
	? Rest
	: Length<T> extends 0 // If the array is empty, return an empty array
	? []
	: never;

/** Removes the first parameter from a function type. */
export type DropFirstParameter<F extends (...args: any) => any> = DropFirstElement<Parameters<F>>;

/** Removes the last parameter from a function type. */
export type DropLastParameter<F extends (...args: any) => any> = DropLastElement<Parameters<F>>;

type AppendNonBlankString<PT extends string[], S extends string> = S extends "" ? PT : [...PT, S];

/** Represents the possible tuples that can result from Object.entries */
export type ObjectEntry<T> = { [K in keyof T]: [K, T[K]] }[keyof T];

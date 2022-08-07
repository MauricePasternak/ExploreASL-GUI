/**
 * Type describing possible options for reading a JSON file.
 */
export type ReadJSONError = {
  type: "FileIsNotJSON" | "ParseError";
  message: string;
};

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

/** Display a number or comma-separated number array in a text input. */
export function formatNumberOrArray(value: number | number[] | undefined): string {
  if (value === undefined) {
    return "";
  }
  if (Array.isArray(value)) {
    return value.join(", ");
  }
  return String(value);
}

/** Display a numeric array as comma-separated text. */
export function formatNumberArray(value: number[] | undefined): string {
  if (value === undefined || value.length === 0) {
    return "";
  }
  return value.join(", ");
}

/** Parse comma-separated numbers into an array. Empty input → undefined. */
export function parseCommaSeparatedNumbers(text: string): ParseResult<number[] | undefined> {
  const trimmed = text.trim();
  if (trimmed === "") {
    return { ok: true, value: undefined };
  }

  const parts = trimmed.split(",").map((part) => part.trim());
  const numbers: number[] = [];

  for (const part of parts) {
    if (part === "") {
      continue;
    }
    const parsed = Number(part);
    if (Number.isNaN(parsed)) {
      return { ok: false, error: `Invalid number: "${part}"` };
    }
    numbers.push(parsed);
  }

  if (numbers.length === 0) {
    return { ok: true, value: undefined };
  }

  return { ok: true, value: numbers };
}

/**
 * Parse text as a single number, or comma-separated array when a comma is present.
 * Empty input → undefined.
 */
export function parseNumberOrArray(text: string): ParseResult<number | number[] | undefined> {
  const trimmed = text.trim();
  if (trimmed === "") {
    return { ok: true, value: undefined };
  }

  if (trimmed.includes(",")) {
    const arrayResult = parseCommaSeparatedNumbers(trimmed);
    if (!arrayResult.ok) {
      return arrayResult;
    }
    const values = arrayResult.value;
    if (values === undefined) {
      return { ok: true, value: undefined };
    }
    if (values.length === 1) {
      return { ok: true, value: values[0] };
    }
    return { ok: true, value: values };
  }

  const parsed = Number(trimmed);
  if (Number.isNaN(parsed)) {
    return { ok: false, error: `Invalid number: "${trimmed}"` };
  }
  return { ok: true, value: parsed };
}

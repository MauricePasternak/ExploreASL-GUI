import { TextInput } from "@mantine/core";
import { useState } from "react";
import {
  formatNumberArray,
  formatNumberOrArray,
  parseCommaSeparatedNumbers,
  parseNumberOrArray,
  type ParseResult,
} from "../lib/commaNumbers";

function valueKey(v: unknown): string {
  if (v === undefined) return "undefined";
  return JSON.stringify(v);
}

export interface CommaNumberInputProps {
  label: React.ReactNode;
  description?: string;
  placeholder?: string;
  value: number | number[] | string | undefined;
  onChange: (value: number | number[] | string | undefined) => void;
  error?: string;
  testId?: string;
}

export function CommaNumberInput(props: CommaNumberInputProps) {
  return <CommaInput {...props} parse={parseNumberOrArray} format={formatNumberOrArray} />;
}

export interface CommaArrayInputProps {
  label: React.ReactNode;
  description?: string;
  placeholder?: string;
  value: number[] | string | undefined;
  onChange: (value: number[] | string | undefined) => void;
  error?: string;
  testId?: string;
}

export function CommaArrayInput(props: CommaArrayInputProps) {
  return <CommaInput {...props} parse={parseCommaSeparatedNumbers} format={formatNumberArray} />;
}

function CommaInput<T extends number | number[]>({
  value,
  onChange,
  testId,
  parse,
  format,
  ...props
}: Omit<CommaNumberInputProps, "value" | "onChange"> & {
  value: T | string | undefined;
  onChange: (value: T | string | undefined) => void;
  parse: (text: string) => ParseResult<T | undefined>;
  format: (value: T | undefined) => string;
}) {
  const [localText, setLocalText] = useState(() => {
    if (typeof value === "string") return value;
    return format(value);
  });
  const [isFocused, setIsFocused] = useState(false);
  const [prevValueKey, setPrevValueKey] = useState(() => valueKey(value));

  const currentKey = valueKey(value);
  if (currentKey !== prevValueKey) {
    setPrevValueKey(currentKey);
    if (!isFocused) {
      const currentTextFormatted = typeof value === "string" ? value : format(value);
      const parsedLocal = parse(localText);
      const parsedValue = typeof value === "string" ? parse(value) : { ok: true, value };
      const localValStr = parsedLocal.ok ? valueKey(parsedLocal.value) : "invalid";
      const valueValStr = parsedValue.ok ? valueKey(parsedValue.value) : "invalid";
      if (localValStr !== valueValStr) {
        setLocalText(currentTextFormatted);
      }
    }
  }

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const text = event.currentTarget.value;
    setLocalText(text);

    const result = parse(text);
    onChange(result.ok ? result.value : text); // Keep invalid drafts for schema validation.
  };

  return (
    <TextInput
      {...props}
      value={localText}
      onChange={handleChange}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
      data-testid={testId}
    />
  );
}

import { TextInput } from "@mantine/core";
import { useEffect, useState } from "react";
import {
  formatNumberArray,
  formatNumberOrArray,
  parseCommaSeparatedNumbers,
  parseNumberOrArray,
} from "../lib/commaNumbers";

export interface CommaNumberInputProps {
  label: React.ReactNode;
  description?: string;
  placeholder?: string;
  value: number | number[] | string | undefined;
  onChange: (value: number | number[] | string | undefined) => void;
  error?: string;
  testId?: string;
}

export function CommaNumberInput({
  label,
  description,
  placeholder,
  value,
  onChange,
  error,
  testId,
}: CommaNumberInputProps) {
  const [localText, setLocalText] = useState(() => {
    if (typeof value === "string") return value;
    return formatNumberOrArray(value);
  });

  useEffect(() => {
    const currentTextFormatted = typeof value === "string" ? value : formatNumberOrArray(value);
    const parsedLocal = parseNumberOrArray(localText);
    const parsedValue = typeof value === "string" ? parseNumberOrArray(value) : { ok: true, value };

    const localValStr = parsedLocal.ok ? JSON.stringify(parsedLocal.value) : null;
    const valueValStr = parsedValue.ok ? JSON.stringify(parsedValue.value) : null;

    if (localValStr !== valueValStr) {
      setLocalText(currentTextFormatted);
    }
  }, [value]);

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const text = event.currentTarget.value;
    setLocalText(text);

    if (text.trim() === "") {
      onChange(undefined);
      return;
    }

    const result = parseNumberOrArray(text);
    if (result.ok) {
      onChange(result.value);
    } else {
      onChange(text); // Pass raw invalid string to trigger schema validation error
    }
  };

  return (
    <TextInput
      label={label}
      description={description}
      placeholder={placeholder}
      value={localText}
      onChange={handleChange}
      error={error}
      data-testid={testId}
    />
  );
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

export function CommaArrayInput({
  label,
  description,
  placeholder,
  value,
  onChange,
  error,
  testId,
}: CommaArrayInputProps) {
  const [localText, setLocalText] = useState(() => {
    if (typeof value === "string") return value;
    return formatNumberArray(value);
  });

  useEffect(() => {
    const currentTextFormatted = typeof value === "string" ? value : formatNumberArray(value);
    const parsedLocal = parseCommaSeparatedNumbers(localText);
    const parsedValue = typeof value === "string" ? parseCommaSeparatedNumbers(value) : { ok: true, value };

    const localValStr = parsedLocal.ok ? JSON.stringify(parsedLocal.value) : null;
    const valueValStr = parsedValue.ok ? JSON.stringify(parsedValue.value) : null;

    if (localValStr !== valueValStr) {
      setLocalText(currentTextFormatted);
    }
  }, [value]);

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const text = event.currentTarget.value;
    setLocalText(text);

    if (text.trim() === "") {
      onChange(undefined);
      return;
    }

    const result = parseCommaSeparatedNumbers(text);
    if (result.ok) {
      onChange(result.value);
    } else {
      onChange(text); // Pass raw invalid string to trigger schema validation error
    }
  };

  return (
    <TextInput
      label={label}
      description={description}
      placeholder={placeholder}
      value={localText}
      onChange={handleChange}
      error={error}
      data-testid={testId}
    />
  );
}

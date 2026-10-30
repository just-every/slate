import { useRef } from "react";

/** The last value that arrived: a list keeps showing it while a filter change refetches, so rows update in place (U9). */
export function useSettled<T>(value: T | undefined): T | undefined {
  const last = useRef<T | undefined>(value);
  if (value !== undefined) last.current = value;
  return last.current;
}

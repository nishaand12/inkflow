import { useEffect, useState } from "react";

/**
 * Value that settles `delay` ms after the last change.
 *
 * Used to keep search-as-you-type from firing a request per keystroke now
 * that customer lookup happens server-side.
 */
export function useDebouncedValue(value, delay = 250) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    if (delay <= 0) {
      setDebounced(value);
      return undefined;
    }
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}

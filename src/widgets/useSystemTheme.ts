import { useEffect, useState } from "react";
import type { SystemTheme } from "./appearance";

const query = "(prefers-color-scheme: dark)";

export default function useSystemTheme(): SystemTheme {
  const [theme, setTheme] = useState<SystemTheme>(() => (window.matchMedia(query).matches ? "dark" : "light"));

  useEffect(() => {
    const media = window.matchMedia(query);
    const update = (event: MediaQueryListEvent) => setTheme(event.matches ? "dark" : "light");
    setTheme(media.matches ? "dark" : "light");
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  return theme;
}

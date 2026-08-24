import { useEffect, useState } from "react";

type Theme = "dark" | "light";

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    const stored = window.localStorage.getItem("rdx-theme") as Theme | null;
    const initial: Theme = stored ?? "dark";
    setTheme(initial);
    document.documentElement.classList.toggle("dark", initial === "dark");
  }, []);

  function apply(next: Theme) {
    setTheme(next);
    window.localStorage.setItem("rdx-theme", next);
    document.documentElement.classList.toggle("dark", next === "dark");
  }

  return (
    <button
      type="button"
      aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      onClick={() => apply(theme === "dark" ? "light" : "dark")}
      className="fixed top-3 right-3 z-50 rounded-full px-3 py-2 text-[10px] font-bold uppercase tracking-widest bg-secondary text-secondary-foreground neon-border-sky hover:opacity-90"
    >
      {theme === "dark" ? "☀ Light" : "☾ Dark"}
    </button>
  );
}

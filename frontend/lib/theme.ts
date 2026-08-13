export type Theme = "light" | "dark"

/** Single source of truth for the key. The pre-paint script below reads the same
 *  constant, so the two can never drift apart. */
export const THEME_STORAGE_KEY = "ros_theme"

/** Vellum — the light theme — is the reference design, so it is the default.
 *  The use scene decides this rather than category habit: the job here is
 *  reading multi-paragraph cited answers, and the drafting stock the whole
 *  design is derived from is a light surface. Dark is fully designed as its own
 *  selected set of steps, not a flip, for anyone working at night.
 *
 *  The OS preference is deliberately not consulted: handing a first-time visitor
 *  the secondary treatment means most people never see the reference design. */
export const DEFAULT_THEME: Theme = "light"

/**
 * Runs as a blocking inline script before the first paint.
 *
 * It writes `.dark` or `.light` — always one, never neither. `:root` already
 * carries the dark values, so the class is not what makes dark mode work; what
 * needs it is Tailwind's `dark:` variant, which components/ui/* use internally.
 * Leaving the class off would have those components render their light styling
 * on a black page.
 *
 * Inline and synchronous because anything deferred is already too late: the
 * paint would land first and every load would flash the wrong theme.
 *
 * try/catch because reading localStorage throws outright in Safari's private
 * mode, and an uncaught throw here would take the whole document with it.
 */
export const THEME_INIT_SCRIPT = `
(function() {
  var theme = "${DEFAULT_THEME}";
  try {
    var stored = localStorage.getItem("${THEME_STORAGE_KEY}");
    if (stored === "light" || stored === "dark") theme = stored;
  } catch (e) {}
  var root = document.documentElement;
  // remove before add: the server already rendered DEFAULT_THEME on <html>, so
  // adding "light" without clearing it would leave both classes present and the
  // .light overrides would win only by source order.
  root.classList.remove("dark", "light");
  root.classList.add(theme);
})();
`.trim()

function getStoredTheme(): Theme | null {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    return stored === "light" || stored === "dark" ? stored : null
  } catch {
    return null
  }
}

/** What the pre-paint script decided, so the toggle's icon matches the class
 *  that is already on <html>. */
export function resolveTheme(): Theme {
  return getStoredTheme() ?? DEFAULT_THEME
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement

  // Fade the swap instead of letting every surface snap. The attribute enables a
  // transition rule in globals.css and is removed straight after — leaving it on
  // would put a 200ms lag on every ordinary hover in the app.
  root.setAttribute("data-theme-transition", "")
  window.setTimeout(() => root.removeAttribute("data-theme-transition"), 250)

  // Both classes are managed together: exactly one must be present at all times.
  root.classList.toggle("dark", theme === "dark")
  root.classList.toggle("light", theme === "light")

  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    /* Preference will not persist. Not worth failing the click over. */
  }
}

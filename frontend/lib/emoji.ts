/** Telegram-style input sugar: emoticons become emoji as you type, and what you
 *  are typing about suggests a few reactions. */

/** Longest keys first, so ":-))" is matched before ":-)" and "<3" before "<".
 *  A Map keeps that order explicit rather than depending on object key order. */
const EMOTICONS = new Map<string, string>([
  [":-)", "🙂"], [":)", "🙂"],
  [":-(", "🙁"], [":(", "🙁"],
  [":-D", "😄"], [":D", "😄"],
  [";-)", "😉"], [";)", "😉"],
  [":-P", "😛"], [":P", "😛"],
  [":-O", "😮"], [":O", "😮"],
  [":'(", "😢"],
  ["<3", "❤️"],
  [":+1", "👍"],
  [":fire", "🔥"],
  [":brain", "🧠"],
])

/**
 * Replaces a trailing emoticon with its emoji.
 *
 * Only ever looks at the END of the string, and only when the caret is there —
 * rewriting mid-string would move the caret out from under the user while they
 * are editing earlier text, which is how naive autoreplace ends up feeling
 * hostile.
 */
export function replaceTrailingEmoticon(value: string): string {
  for (const [pattern, emoji] of EMOTICONS) {
    if (value.endsWith(pattern)) {
      // Guard against eating part of a word: ":D" inside "3:Dx" is not an
      // emoticon. The char before must be whitespace or the start of the input.
      const before = value.slice(0, value.length - pattern.length)
      if (before === "" || /\s$/.test(before)) {
        return before + emoji + " "
      }
    }
  }
  return value
}

interface Suggestion {
  emoji: string
  /** Matched against the lower-cased query. */
  test: RegExp
}

/** Small and opinionated on purpose. A suggestion rail that fires on everything
 *  is noise; one that fires on the shape of a research question is a wink. */
const SUGGESTIONS: Suggestion[] = [
  { emoji: "🤔", test: /\b(why|how come|explain|reason)\b/ },
  { emoji: "⚖️", test: /\b(compare|versus|vs\.?|difference|better)\b/ },
  { emoji: "🧠", test: /\b(transformer|attention|neural|llm|model|embedding)\b/ },
  { emoji: "🔬", test: /\b(experiment|benchmark|evaluat|measure|ablation)\b/ },
  { emoji: "📉", test: /\b(limitation|drawback|fail|weakness|problem)\b/ },
  { emoji: "🔥", test: /\b(state of the art|sota|best|breakthrough)\b/ },
  { emoji: "📚", test: /\b(survey|review|literature|overview)\b/ },
  { emoji: "❓", test: /\?\s*$/ },
]

/** At most three, so the rail never turns into a keyboard. */
export function suggestEmoji(query: string, limit = 3): string[] {
  const q = query.toLowerCase()
  const hits: string[] = []
  for (const s of SUGGESTIONS) {
    if (s.test.test(q)) {
      hits.push(s.emoji)
      if (hits.length >= limit) break
    }
  }
  return hits
}

/** Thrown up from the send button when a question goes out. */
export const CELEBRATION_EMOJI = ["✨", "📚", "🔎", "🧠", "💡", "📄", "⚡", "🪄"]

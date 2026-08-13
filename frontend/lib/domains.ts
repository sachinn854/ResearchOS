/** The domain list used by both the chat filter and the ingest form. It was
 *  duplicated in the two pages, and they had already drifted — the chat page
 *  carried a decorative glyph per domain that the ingest page did not. */
export interface DomainOption {
  value: string
  label: string
}

export const ALL_DOMAINS = "all"

export const DOMAINS: DomainOption[] = [
  { value: "ml", label: "Machine learning" },
  { value: "dl", label: "Deep learning" },
  { value: "cs", label: "Computer science" },
  { value: "physics", label: "Physics" },
  { value: "bio", label: "Biology" },
  { value: "finance", label: "Finance" },
  { value: "math", label: "Mathematics" },
]


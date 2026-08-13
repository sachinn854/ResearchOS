import { useId } from "react"

import { cn } from "@/lib/utils"

/** Label + input, wired together by a generated id. The pages previously used
 *  bare <label> elements with no `htmlFor`, so clicking a label did not focus its
 *  field and screen readers read the two as unrelated. */
export function TextField({
  label,
  hint,
  className,
  ...props
}: React.ComponentProps<"input"> & { label: string; hint?: string }) {
  const id = useId()
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-ui font-bold text-foreground">
        {label}
      </label>
      <input id={id} className={cn("field", className)} {...props} />
      {hint && <p className="text-meta text-ink-subtle">{hint}</p>}
    </div>
  )
}

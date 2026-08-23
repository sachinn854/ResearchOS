import { useId } from "react"

import { cn } from "@/lib/utils"

/** Label + input, wired together by a generated id so clicking the label
 *  focuses its field and screen readers read them as related. */
export function TextField({
  label,
  hint,
  className,
  ...props
}: React.ComponentProps<"input"> & { label: string; hint?: string }) {
  const id = useId()
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="label-meta block">
        {label}
      </label>
      <input id={id} className={cn("field", className)} {...props} />
      {hint && <p className="text-meta text-ink-subtle">{hint}</p>}
    </div>
  )
}

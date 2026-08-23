import { BrandMark, Wordmark } from "@/components/brand-mark"
import { ThemeToggle } from "@/components/theme-toggle"

/** Shared frame for /login and /signup, which were byte-for-byte identical apart
 *  from the heading, the form, and the footer link. */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string
  subtitle: string
  children: React.ReactNode
  footer: React.ReactNode
}) {
  return (
    <div className="relative flex min-h-dvh items-center justify-center bg-canvas p-4 sm:p-6">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(820px 520px at 22% 8%, color-mix(in oklab, var(--primary) 10%, transparent), transparent 65%), radial-gradient(760px 520px at 88% 12%, color-mix(in oklab, var(--primary) 7%, transparent), transparent 65%)",
        }}
      />
      <div className="absolute top-4 right-4 sm:top-6 sm:right-6">
        <ThemeToggle className="rounded-full border border-border bg-card" />
      </div>

      <div className="animate-exchange-in relative grid w-full max-w-[980px] overflow-hidden rounded-[24px] border border-border bg-card shadow-column lg:grid-cols-[1.05fr_0.95fr]">
        <div className="hidden flex-col justify-between bg-list p-8 lg:flex">
          <div>
            <div className="flex items-center gap-3">
              <BrandMark size="md" />
              <Wordmark className="text-[18px]" />
            </div>
            <p className="mt-6 font-serif text-[28px] font-semibold leading-[0.98] tracking-[-0.03em] text-foreground">
              Cited answers across
              <br />
              your papers.
            </p>
            <p className="mt-3 max-w-[32ch] text-[14px] leading-6 text-muted-foreground">
              ResearchOS turns your library into a cited workspace. Every answer points to the page and passage
              it came from.
            </p>
          </div>
          <div className="space-y-3">
            <div className="rounded-2xl border border-border bg-card p-4">
              <p className="font-mono text-[11px] font-semibold tracking-[0.08em] text-ink-subtle">
                WHAT YOU GET
              </p>
              <ul className="mt-3 space-y-2 text-[13px] leading-5 text-muted-foreground">
                <li className="flex gap-2">
                  <span className="mt-1 size-1.5 shrink-0 rounded-full bg-brand-deep" />
                  Dense + sparse + RRF retrieval
                </li>
                <li className="flex gap-2">
                  <span className="mt-1 size-1.5 shrink-0 rounded-full bg-brand-deep" />
                  Numbered citations you can open
                </li>
                <li className="flex gap-2">
                  <span className="mt-1 size-1.5 shrink-0 rounded-full bg-brand-deep" />
                  Private, per-account library
                </li>
              </ul>
            </div>
            <p className="font-mono text-[11px] text-ink-subtle">Private workspace · No training on your data</p>
          </div>
        </div>

        <div className="p-7 sm:p-9">
          <div className="flex items-center gap-3 lg:hidden">
            <BrandMark size="md" />
            <Wordmark className="text-[16px]" />
          </div>

          <h1 className="mt-5 font-serif text-[26px] font-semibold tracking-[-0.025em] text-foreground sm:text-[28px] lg:mt-0">
            {title}
          </h1>
          <p className="mt-2 text-[14px] leading-6 text-muted-foreground">{subtitle}</p>

          <div className="mt-7">{children}</div>

          <p className="mt-7 text-center text-[14px] text-muted-foreground">{footer}</p>
        </div>
      </div>
    </div>
  )
}

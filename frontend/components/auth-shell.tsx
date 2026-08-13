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
    <div className="bg-canvas relative flex min-h-dvh items-center justify-center p-3">
      <div className="absolute top-5 right-5">
        <ThemeToggle />
      </div>

      {/* One card on the canvas, drawn the same way every panel in the app is.
          The ruling, the grain and the animated border that were here are gone:
          this is a page you pass through in fifteen seconds, and it was carrying
          more visual effort than the screen where the work happens. */}
      <div className="bg-card column animate-exchange-in w-full max-w-md p-7 sm:p-9">
        <div className="mb-7 flex items-center gap-3">
          <BrandMark size="lg" />
          <Wordmark className="text-title-sm" />
        </div>

        <h1 className="font-display text-title-lg text-foreground">{title}</h1>
        <p className="mt-2 text-read text-muted-foreground">{subtitle}</p>

        <div className="mt-7">{children}</div>

        <p className="mt-7 text-ui text-muted-foreground">{footer}</p>
      </div>
    </div>
  )
}

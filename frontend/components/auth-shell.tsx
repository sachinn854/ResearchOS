import Link from "next/link"

import { BrandMark, Wordmark } from "@/components/brand-mark"
import { ThemeToggle } from "@/components/theme-toggle"

const PROOF_POINTS = [
  { k: "01", label: "Hybrid retrieval", detail: "dense + sparse + RRF fusion" },
  { k: "02", label: "Openable citations", detail: "every [n] links to its passage" },
  { k: "03", label: "Private library", detail: "per-account, never trained on" },
]

/** Shared frame for /login and /signup.
 *
 *  Full-bleed split instead of a floating card: the left half is the product's
 *  identity — dark indigo field, blueprint grid, the three proof points — and
 *  the right half is nothing but the form on a quiet surface. Below lg the
 *  brand panel drops away; the form is the product there. */
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
    <div className="grid min-h-dvh lg:grid-cols-[1fr_1.05fr]">
      {/* --- brand panel ---------------------------------------------- */}
      <div className="relative hidden flex-col justify-between overflow-hidden bg-[#12101f] p-10 text-white lg:flex xl:p-14">
        {/* Blueprint grid over a deep indigo-black field, fading toward the
            bottom so type always sits on solid ground. */}
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            backgroundImage:
              "linear-gradient(rgba(165,180,252,0.09) 1px, transparent 1px), linear-gradient(90deg, rgba(165,180,252,0.09) 1px, transparent 1px)",
            backgroundSize: "44px 44px",
            maskImage: "linear-gradient(to bottom, black 0%, transparent 85%)",
          }}
        />
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(640px 420px at 18% 12%, rgba(99,102,241,0.32), transparent 65%), radial-gradient(520px 380px at 82% 88%, rgba(129,140,248,0.16), transparent 60%)",
          }}
        />

        <Link href="/" className="relative flex items-center gap-3 text-white" aria-label="ResearchOS home">
          <BrandMark size="lg" />
          <Wordmark className="text-[17px] text-white" />
        </Link>

        <div className="relative">
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-indigo-200/80">
            Research workspace
          </p>
          <p className="font-display mt-4 max-w-[16ch] text-[34px] font-semibold leading-[1.06] tracking-[-0.02em] xl:text-[40px]">
            Answers you can trace to the page.
          </p>
          <p className="mt-4 max-w-[38ch] text-[15px] leading-relaxed text-indigo-100/70">
            ResearchOS reads your library and writes cited answers — retrieval, verification and
            page-level evidence in one pass.
          </p>
        </div>

        <dl className="relative space-y-4">
          {PROOF_POINTS.map(p => (
            <div key={p.k} className="flex items-baseline gap-4 border-t border-white/10 pt-4">
              <dt className="w-full min-w-0 flex-1">
                <span className="block text-[14px] font-semibold text-white">{p.label}</span>
                <span className="block font-mono text-[11px] text-indigo-200/60">{p.detail}</span>
              </dt>
              <dd className="font-mono text-[11px] text-indigo-300/70">{p.k}</dd>
            </div>
          ))}
        </dl>
      </div>

      {/* --- form column ---------------------------------------------- */}
      <div className="relative flex flex-col bg-canvas">
        <div className="flex items-center justify-between p-5 sm:p-6">
          <Link href="/" className="flex items-center gap-2.5 lg:invisible" aria-label="ResearchOS home">
            <BrandMark size="sm" />
            <Wordmark className="text-[15px]" />
          </Link>
          <ThemeToggle className="rounded-lg border border-border bg-card" />
        </div>

        <div className="animate-rise-in mx-auto flex w-full max-w-[400px] flex-1 flex-col justify-center px-6 pb-16 sm:px-8">
          <h1 className="font-display text-[28px] font-semibold tracking-[-0.02em] text-foreground">
            {title}
          </h1>
          <p className="mt-2.5 text-ui-lg leading-relaxed text-muted-foreground">{subtitle}</p>

          <div className="mt-8">{children}</div>

          <p className="mt-8 border-t border-border pt-6 text-center text-ui text-muted-foreground">
            {footer}
          </p>
        </div>
      </div>
    </div>
  )
}

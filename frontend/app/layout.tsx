import type { Metadata } from "next";
import { IBM_Plex_Mono, Inter, Space_Grotesk } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/lib/auth-context";
import { DEFAULT_THEME, THEME_INIT_SCRIPT } from "@/lib/theme";

// Three faces with one job each. Space Grotesk is the voice of the product —
// headlines, wordmarks, question headings; its slightly engineered letterforms
// carry the "instrument" character. Inter does everything a person operates.
const grotesk = Space_Grotesk({
  variable: "--font-grotesk",
  subsets: ["latin"],
  display: "swap",
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

// Readouts: relevance scores, page references, counts, the rate-limit clock.
const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "ResearchOS",
  description: "Ask across the papers you have. Every answer cites the passage it came from.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // suppressHydrationWarning because the script below sets the theme class
    // before React hydrates, so the client's className legitimately differs from
    // what the server rendered.
    <html
      lang="en"
      suppressHydrationWarning
      className={`${DEFAULT_THEME} ${grotesk.variable} ${inter.variable} ${plexMono.variable}`}
    >
      <body className="min-h-dvh">
        {/* First child of <body> on purpose: an inline script runs at parse
            time, the only point early enough to set the theme without a flash
            of the wrong one. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        {/* AuthProvider is a client component, so the layout stays a server
            component and only this subtree hydrates. */}
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}

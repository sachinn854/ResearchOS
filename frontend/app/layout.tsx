import type { Metadata } from "next";
import { DM_Mono, Instrument_Sans, Source_Serif_4 } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/lib/auth-context";
import { DEFAULT_THEME, THEME_INIT_SCRIPT } from "@/lib/theme";

// Three faces, and the split between the first two is the whole idea: what you
// read is set differently from what you operate.
//
// Answers here run to several paragraphs with tables and citations in them —
// that is reading, not scanning, and it is what a text face is for. Source Serif
// 4 was drawn for screen reading specifically, with a real weight axis, so the
// question headings can be cut from the same face as the prose underneath them.
const sourceSerif = Source_Serif_4({
  variable: "--font-source-serif",
  subsets: ["latin"],
  display: "swap",
});

// The interface: buttons, labels, the composer, the evidence rail. Instrument
// Sans is a neutral grotesque — it has no opinion, which is right for chrome
// sitting next to text that does. The app was previously set in one friendly
// geometric sans throughout, which is the face every AI product template ships
// with and reads as one.
const instrumentSans = Instrument_Sans({
  variable: "--font-instrument",
  subsets: ["latin"],
  display: "swap",
});

// Only the numbers that must not shift as they change: relevance scores, page
// references, counts, the rate-limit clock.
const dmMono = DM_Mono({
  variable: "--font-dm-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
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
    //
    // DEFAULT_THEME is carried in className as the no-JS floor: with scripting
    // off, the dark:* utilities inside components/ui/* still need an ancestor.
    <html
      lang="en"
      suppressHydrationWarning
      className={`${DEFAULT_THEME} ${instrumentSans.variable} ${sourceSerif.variable} ${dmMono.variable}`}
    >
      {/* AuthProvider is a client component, so the layout itself stays a server
          component and only the provider subtree hydrates. Every page shares one
          auth state instead of each re-checking the token. */}
      <body className="min-h-dvh">
        {/* First child of <body> on purpose: the browser runs an inline script at
            parse time, the only point early enough to set the theme without a
            flash of the wrong one. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { Nav, ThemeToggle } from "@/components/Nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "NBA Edge",
  description: "Analiza NBA: projekcje zawodników, analiza rywali i ocena zakładów z priorytetem dla polskich bukmacherów.",
};

const themeScript = `try{var t=localStorage.getItem("theme");if(t)document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pl" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      {/* suppressHydrationWarning: browser extensions (e.g. Grammarly) add attributes to <body> before React loads */}
      <body className="min-h-screen" suppressHydrationWarning>
        <div className="mx-auto flex max-w-[1500px] flex-col lg:flex-row">
          <aside className="sticky top-0 z-20 border-b border-line bg-bg/95 px-4 py-3 backdrop-blur lg:h-screen lg:w-60 lg:shrink-0 lg:border-b-0 lg:border-r lg:py-6">
            <div className="mb-3 flex items-center justify-between lg:mb-8">
              <Link href="/" className="flex items-center gap-2">
                <span className="rounded-md bg-accent px-1.5 py-0.5 text-sm font-black text-black">NBA</span>
                <span className="text-lg font-black tracking-tight">EDGE</span>
              </Link>
              <ThemeToggle />
            </div>
            <Nav />
            <p className="mt-8 hidden text-[11px] leading-relaxed text-ink-3 lg:block">
              Prawdopodobieństwa to statystyczne szacunki obarczone niepewnością, a nie gwarancje. Graj odpowiedzialnie — hazard może uzależniać (pomoc: 801 889 880).
            </p>
          </aside>
          <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-8">{children}</main>
        </div>
      </body>
    </html>
  );
}

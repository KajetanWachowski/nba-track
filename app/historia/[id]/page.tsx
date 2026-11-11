import { JetBrains_Mono, Oswald } from "next/font/google";
import Link from "next/link";
import { StoryViewer } from "@/components/StoryViewer";
import { Notice } from "@/components/ui";
import { loadSlate } from "@/lib/page-data";
import { buildStory } from "@/lib/story";

export const dynamic = "force-dynamic";

const head = Oswald({ subsets: ["latin", "latin-ext"], weight: ["700"], variable: "--font-story-head" });
const mono = JetBrains_Mono({ subsets: ["latin", "latin-ext"], weight: ["500", "700"], variable: "--font-story-mono" });

export default async function StoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const betId = decodeURIComponent(id);
  const { a, error } = await loadSlate();
  if (!a) return <Notice tone="neg">Nie udało się wczytać meczów: {error}</Notice>;
  const b = a.bets.find((x) => x.id === betId);
  const d = b ? await buildStory(b) : null;
  if (!b || !d) {
    return (
      <div className="space-y-3">
        <Notice>Historii nie da się zbudować dla tego zakładu (to nie jest zakład zawodnika albo nie ma go już w dzisiejszej analizie).</Notice>
        <Link href="/value-bets" className="text-accent">← Wróć do propozycji</Link>
      </div>
    );
  }
  return (
    <div className={`${head.variable} ${mono.variable} mx-auto max-w-3xl`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm">
        <Link href={`/analiza/${encodeURIComponent(b.id)}`} className="text-accent">← Pełna analiza</Link>
        <span className="text-ink-3">Stuknij prawą / lewą stronę grafiki albo użyj strzałek. Grafiki zapisują się w rozmiarze 1080×1920.</span>
      </div>
      <StoryViewer d={JSON.parse(JSON.stringify(d))} />
    </div>
  );
}

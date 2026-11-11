# NBA EDGE — analityka NBA i wyszukiwarka value betów

Platforma, która pobiera rzeczywiste dane NBA i kursy bukmacherskie, szacuje prawdopodobieństwa
zdarzeń własnym modelem statystycznym, porównuje je z prawdopodobieństwem z kursu (z usuniętą
marżą) i pokazuje, gdzie kurs jest — według modelu — źle wyceniony. Każda liczba pochodzi z
prawdziwego źródła; jeśli źródło nie odpowiada, aplikacja pokazuje ostatnią poprawną kopię
oznaczoną jako nieaktualną albo komunikat o braku danych. Nic nie jest zmyślane.

> Prawdopodobieństwa są estymacjami z niepewnością, a nie gwarancjami. Patrz sekcja
> **„Wyniki i uczciwa ocena”** — na dziś model nie wykazał przewagi, która pokonuje marżę.

## Jak NBA EDGE ocenia zakłady (wersja 2)

Najważniejsza jest **jakość i wiarygodność prognozy**, dopiero potem kurs. Samo dodatnie EV nigdy nie wystarcza.

Każdy zakład dostaje trzy niezależne oceny:

| Ocena | Co mierzy |
|---|---|
| **Prawdopodobieństwo** | skalibrowana szansa realizacji z przedziałem niepewności |
| **Jakość danych** (0–100) | liczba meczów, stabilność minut, zmiana roli, kontuzje, wiarygodność kursu, weryfikacja w backteście |
| **Opłacalność** | EV i przewaga na kursie **Superbet** (gdy brak — najlepszy polski bukmacher) |

oraz listę **argumentów za** i **ryzyk** (krytyczne / istotne / drobne): forma z ostatnich 5 i 10 meczów,
konflikt sezon vs ostatnie mecze, trend, nieregularność, zmiana minut i usage, powrót po absencji,
liczba prób za 3 i skuteczność, obrona rywala na pozycji i na obwodzie, tempo, ryzyko blowoutu,
back-to-back, status zawodnika i kolegów, rozbieżność model/rynek, ruch linii, wiek kursu.

Kategorie (progi w `lib/assess.ts → THRESHOLDS`):

- **Najlepsze** — p ≥ 58%, jakość ≥ 70, EV ≥ +2%, model co najmniej tak pewny jak rynek, ≤ 1 istotne ryzyko.
- **Dobre** — p ≥ 53%, jakość ≥ 55, EV ≥ 0, ≤ 2 istotne ryzyka.
- **Warte obserwacji** — blisko progu, brak kursu polskiego albo typ zakładu niezweryfikowany w backteście.
- **Odrzucone** — każde ryzyko krytyczne (np. 0/5 ostatnich meczów po stronie zakładu, niepewny status) albo słabe parametry.

Najlepsze i Dobre wymagają: kursu polskiego bukmachera **oraz** tego, że dla danego typu zakładu skalibrowany
model był w backteście lepszy od rynku (np. obecnie: zbiórki, asysty, trójki, Pkt+Zb, Zb+As — tak; punkty,
PRA, Pkt+As i linie meczowe — nie). Preferowany zakres kursów 1.70–2.20 daje tylko niewielki bonus w rankingu.

Kursy: **Superbet → Betclic → Betfan → inni polscy** (Fortuna, STS, Forbet przez OddsPapi). Kursy USA
(DraftKings) są wyłącznie punktem odniesienia i nigdy nie są traktowane jako kurs do zagrania w Polsce.
Kursy wpisane ręcznie są oznaczone jako niezweryfikowane, z czasem wpisania.

Model w wersji 2: trójki liczone jako **próby × skuteczność** (rozkład dwumianowy, skuteczność z rozkładu Beta,
korekta na obronę obwodu rywala); **ryzyko blowoutu** z handicapu rynku zmienia minuty w symulacji
(efekt zmierzony na meczach ligi: podstawowi grają krócej, rezerwowi dłużej).

## Szybki start

```bash
npm install
npm run sync        # sezon: terminarz, box score'y, linie meczowe, historyczne linie propsów (~10 s)
npm run backtest -- --tune   # walk-forward backtest + kalibracja prawdopodobieństw (~2–4 min)
npm run dev         # http://localhost:3000
```

Wymagania: Node.js ≥ 22.13 (wbudowany `node:sqlite` — bez natywnych zależności).
Opcjonalnie skopiuj `.env.example` do `.env.local` i ustaw `ODDS_API_KEY` (patrz niżej).

Inne skrypty: `npm test` (testy jednostkowe), `npm run settle` (rozliczenie zapisanych typów),
`npm run build && npm start` (produkcja; serwer co godzinę sam synchronizuje zakończone mecze
i rozlicza typy — wyłączysz to przez `NBA_EDGE_NO_BACKGROUND=1`).

## Źródła danych (sprawdzone na żywo)

| Źródło | Co daje | Klucz |
|---|---|---|
| ESPN `site.api.espn.com` — scoreboard, summary, injuries, teams/roster | terminarz, wyniki, pełne box score'y (z nich: usage rate, pace, defensywa, podziały), kontuzje, składy, kursy DraftKings na mecze (open + aktualne) | nie |
| ESPN `sports.core.api.espn.com` — `propBets` | propsy zawodników DraftKings: O/U, „X+” (milestones), double/triple double, **z kursami otwarcia**; dla zakończonych meczów zostają linie zamknięcia → prawdziwy backtest | nie |
| ESPN `site.web.api.espn.com` — gamelog | logi meczowe z poprzedniego sezonu (priory bayesowskie) | nie |
| **The Odds API** (`api.the-odds-api.com`) | kursy wielu bukmacherów (FanDuel, BetMGM, Caesars, Pinnacle w regionie `eu`…) — line shopping i ostrzejsza referencja no-vig | **tak** |

### Polscy bukmacherzy (strona „Polskie kursy”)

| Bukmacher | Skąd | Co |
|---|---|---|
| **Superbet PL** | OddsPapi v4 (`superbet.pl`) — automatycznie | moneyline, handicap, suma punktów, propsy: punkty, zbiórki, asysty, PRA, P+R, P+A, R+A, trójki, straty (+ drabinki „N+”) |
| Fortuna PL | OddsPapi v4 (`efortuna.pl`) — opcjonalnie | tylko linie meczowe |
| **Betclic PL**, **Betfan** | brak w jakimkolwiek API — wpisujesz ręcznie | dowolny rynek i linia |

Klucz: konto na <https://oddspapi.io> (darmowy plan), w `.env.local` ustaw `ODDSPAPI_KEY=…`
(i opcjonalnie `ODDSPAPI_BOOKMAKERS=superbet.pl:superbet,efortuna.pl:fortuna`). Ręcznie wpisane kursy
mają pierwszeństwo przed kursem z API. Model liczy prawdopodobieństwo dokładnie dla linii bukmachera,
także gdy różni się od DraftKings. Zawodnicy spoza składów obu drużyn (pomyłki w feedzie) są odrzucani.
Podatek 12% od stawki można włączyć w Ustawieniach (domyślnie wyłączony).

**Oszczędzanie limitu OddsPapi:** strony nigdy same nie pytają OddsPapi — używają zapisanych kursów.
Zapytania idą tylko po kliknięciu **„Pobierz kursy”** na stronie „Polskie kursy” (koszt ≈ 1 + liczba meczów;
strona pokazuje koszt i dzisiejsze zużycie). Aplikacja ma własny dzienny limit `ODDSPAPI_DAILY_LIMIT`
(domyślnie 30), nie ponawia odrzuconych zapytań, a błędną nazwę bukmachera zapamiętuje na 24 h, żeby
nie płacić za nią ponownie. Automatyczne odświeżanie włączysz przez `ODDSPAPI_AUTO_REFRESH_MIN` (np. 60).

**Klucz The Odds API:** załóż konto na <https://the-odds-api.com> (darmowy plan: 500 kredytów/mies.),
wpisz `ODDS_API_KEY=...` do `.env.local`. Koszt = rynki × regiony za event; odpowiedzi są cache'owane
30 min, propsy pobierane tylko dla meczów, które się nie zaczęły. Klucz nigdy nie trafia do cache ani logów.

**Czego nie używam i dlaczego:** `stats.nba.com` i `cdn.nba.com` blokują klientów spoza przeglądarki
(403 / wymóg podszywania się pod nagłówki przeglądarki) — nie da się na nich oprzeć niezawodnej
aplikacji. Wszystko, czego potrzebuje model, da się policzyć z box score'ów ESPN.

**Kontuzje:** ESPN podaje tylko „Out” / „Day-To-Day”. Oficjalne Questionable / Doubtful / Probable
wyciągam z treści raportu (`classifyInjury`), a ich niepewność trafia do modelu jako prawdopodobieństwo
absencji (OUT 1.0, DOUBTFUL 0.75, QUESTIONABLE 0.35, DTD 0.25, PROBABLE 0.05).

**Odporność:** każde zapytanie ma timeout, 3 ponowienia z backoffem, cache w SQLite z TTL
(scoreboard 2 min, propsy 5 min, kontuzje 10 min, zakończone mecze na zawsze) i fallback do
ostatniej dobrej kopii z flagą `stale`. Każda strona pokazuje czas ostatniej aktualizacji każdego źródła.
Dostawcy są wymienialni: `lib/providers/*` normalizują dane do wspólnych typów (`GameInfo`, `PropLine`,
`Offer`, `Injury`), a silnik pracuje tylko na nich.

## Architektura

```
app/                     Next.js 16 (App Router) — strony server-side + API routes
  page.tsx               Dashboard
  games/, games/[id]     NBA Games — mecze, projekcja vs rynek, kontuzje, propsy meczu
  players/, players/[id] Player Analysis — wyszukiwarka, wykresy linii, hit rate, projekcja, podziały
  matchups/              Matchup Analysis — DRtg, pace, oddane statystyki, defensywa wg pozycji
  value-bets/            Value Bet Finder — ranking z filtrami (EV, prawdop., rynek, drużyna, pewność)
  odds/                  Odds Comparison — kursy, marża, no-vig, ruch linii, najlepsza cena
  history/               Historical Performance — backtest, kalibracja, ROI/yield/CLV, track record
  settings/              źródła danych, baza, parametry modelu, akcje
  api/                   sync, backtest, settle, value-bets (JSON)
components/              UI (BetTable, PlayerLab, LineBarChart, ReliabilityChart…)
lib/
  providers/espn.ts      ESPN + DraftKings (z weryfikacją stron Over/Under)
  providers/oddsapi.ts   The Odds API
  sync.ts                zapis do SQLite (inkrementalny)
  store.ts, db.ts        dostęp do danych, schemat
  model/context.ts       kontekst ligi „na dzień D” (tylko mecze przed D)
  model/player.ts        model zawodnika (Monte Carlo)
  model/game.ts          model meczu (ML / spread / total)
  model/calibrate.ts     kalibracja logistyczna + metryki
  odds/math.ts           implied, no-vig, edge, EV, fair odds, Kelly, CLV
  engine.ts              analiza slate'u → ocenione zakłady z uzasadnieniem
  backtest.ts            walk-forward backtest na prawdziwych kursach
  tracking.ts            dziennik rekomendacji + rozliczanie + CLV
```

Baza: SQLite (`data/nba-edge.db`) — cache HTTP, mecze, box score'y, linie, predykcje, backtesty.
Przejście na Postgres sprowadza się do podmiany `lib/db.ts` / `lib/store.ts`.

## Silnik prawdopodobieństwa

**Zawodnik** (`lib/model/player.ts`) — dla każdej statystyki (PTS, REB, AST, 3PM, STL, BLK, TOV):

1. **Tempo na minutę**: posterior Gamma z ważonych wykładniczo meczów bieżącego sezonu
   (half-life strojony w backteście), ściągany do tempa z poprzedniego sezonu (albo średniej
   pozycji dla debiutantów). Wielkość próby jest wbudowana — mało meczów = mocne ściąganie i szerszy rozkład.
2. **Minuty**: mieszanka ostatnich i sezonowych minut, regresja do zeszłego sezonu przy małej próbie,
   efekt back-to-back estymowany z danych ligi, nieobecności kolegów: empiryczne podziały
   with/without (z shrinkage), a bez próby — ostrożna, opisana heurystyka redystrybucji.
   Liczą się tylko *świeże* nieobecności (już trwające są w bazowej formie).
3. **Kontekst**: defensywa rywala na posiadanie wobec pozycji zawodnika (G/F/C), pace meczu,
   dom/wyjazd, bardzo mocno ściągnięty wynik head-to-head, korekty de-bias z backtestu.
4. **Rozkład**: Monte Carlo (8–10 tys. symulacji): minuty ~ Normal, statystyka | minuty ~ skalowany
   rozkład ujemny dwumianowy z wariancją `κ·μ + φ·μ²` (κ≈2 dla punktów — punkty wpadają po 2–3),
   plus wspólny czynnik „dobrego/słabego wieczoru” estymowany z kowariancji reszt — dzięki temu
   PRA i double-double mają realistyczną korelację. Niepewność parametrów → przedział 80% dla
   samego prawdopodobieństwa.

**Mecz** (`lib/model/game.ts`): oceny ofensywne/defensywne na 100 posiadań (ważone, korygowane o
siłę rywali, ściągane do średniej), pace, przewaga parkietu i odchylenia reszt estymowane z danych.

**Rynek i EV** (`lib/odds/math.ts`): implied = 1/kurs; no-vig metodą potęgową dla rynków dwustronnych
(dla jednostronnych marża szacowana z tego samego slate'u i oznaczona); edge = p_model − implied;
EV = p_model·kurs − 1; fair odds = 1/p_model; ¼ Kelly informacyjnie.

**Kalibracja** (`lib/model/calibrate.ts`): `p = σ(a + b·logit(p_model) + c·logit(p_rynek))`,
dopasowana regresją logistyczną na wynikach backtestu. To tu model „uczy się”, ile jest wart względem rynku.

**Bramka dowodowa**: typ rynku (propsy / linie meczowe) może generować rekomendacje tylko wtedy, gdy
w ostatnim backteście skalibrowany model pokonał rynek no-vig poza próbą. W przeciwnym razie pewność
jest obniżana do „Low” z wyjaśnieniem. Wysokie prawdopodobieństwo bez dodatniego EV nigdy nie jest rekomendacją.

**Rozwój o ML**: `projectPlayer` zwraca czynniki i rozkład dla każdej statystyki — gotowe cechy dla
modelu GBM/sieci. Harness backtestu (`generateRows`) przyjmie dowolny model i oceni go tą samą,
szczelną procedurą.

## Backtest i brak przecieku danych

- Predykcja dla meczu z dnia D używa wyłącznie meczów z dni < D (`buildContext(D)`).
- Zakłady „stawiane” po **kursach otwarcia DraftKings**; kurs zamknięcia służy tylko do CLV.
- Kalibracja i strojenie parametrów — tylko na wcześniejszych 60% dat; wszystkie metryki na późniejszych 40%.
- Dziennik rekomendacji (`predictions`) jest tylko dopisywany; model go nigdy nie czyta.
- Znane przybliżenie: historyczne nieobecności biorę z box score'ów (kto nie zagrał), bo ESPN nie
  archiwizuje przedmeczowych raportów kontuzji. Linie meczowe z przeszłości mają tylko kurs zamknięcia.

## Wyniki i uczciwa ocena (stan na 10.11.2026, ~3 tygodnie sezonu)

Out-of-sample (daty 3–9 XI, 4 400 linii propsów DraftKings):

| | log-loss model surowy | rynek no-vig | skalibrowany |
|---|---|---|---|
| Propsy zawodników | 0.7060 | 0.6891 | **0.6874** |
| Linie meczowe | 0.7007 | **0.6283** | 0.6331 |

- Przedziały 80% projekcji pokrywają ~80% wyników (punkty 79.9%, PRA 78.6%) — rozkłady są dobrze skalibrowane.
- Średnia projekcji jest jednak słabszym estymatorem niż linia bukmachera (RMSE punktów 6.53 vs 6.26):
  rynek zna newsy, role i składy, których box score'y nie mają.
- Symulacja zakładów z EV ≥ 3%: 671 zakładów, yield +0.9% (±3.6% błąd standardowy), **CLV −4.45%**.
  Ujemne CLV oznacza, że linie poruszały się przeciw typom — to sygnał, że model nie ma realnej przewagi.
- Wniosek: na dziś aplikacja to rzetelne narzędzie analityczne i rama do budowy przewagi, ale
  **nie dowód, że pokonuje bukmachera**. Aplikacja mówi to wprost na dashboardzie i nie oznacza
  jako value betów rzeczy, których skuteczności nie potwierdza backtest. Najbardziej obiecujące
  kierunki: line shopping (The Odds API), wczesne kursy otwarcia, newsy o składach przed meczem,
  dłuższa historia (poprzednie sezony do backtestu), model ML na cechach z `projectPlayer`.

## Ograniczenia pierwszej wersji

- Steals/blocks/turnovers O/U: DraftKings przez ESPN publikuje głównie progi „X+”; pełne O/U (w tym TOV) wymaga The Odds API.
- Kursy otwarcia dla linii meczowych są zapisywane od momentu uruchomienia aplikacji (archiwum ESPN ma tylko zamknięcie).
- Defensywa „wg pozycji” używa grup G/F/C z ESPN (bez danych o krycia 1-na-1, które nie są publicznie dostępne).

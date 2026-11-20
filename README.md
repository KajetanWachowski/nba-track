# NBA EDGE — kupony i analiza NBA

Aplikacja, która codziennie analizuje mecze NBA i proponuje **typy dnia** oraz **trzy kupony**
(🛡️ Pewniaczek ~3, 🥇 Złoty środek ~4, 🧨 Petarda ~5). Do każdego typu pokazuje pełną analizę z wykresami:
formę zawodnika, minuty, rywala, kontuzje i to, jak typ wypadał w przeszłości. Wyniki kuponów widać
na żywo w trakcie meczów.

Wszystkie liczby pochodzą z prawdziwych danych (ESPN, kursy bukmacherów) — nic nie jest zmyślane.

> **18+ · Graj odpowiedzialnie.** Prawdopodobieństwa to szacunki, nie gwarancje — nawet najlepszy kupon
> czasem nie wchodzi. Stawiaj tylko tyle, ile możesz stracić. Pomoc: **801 889 880** (Telefon Zaufania
> Uzależnień Behawioralnych).

**Spis treści**

1. [Co jest potrzebne](#1-co-jest-potrzebne)
2. [Instalacja na komputerze (Windows)](#2-instalacja-na-komputerze-windows)
3. [Instalacja na komputerze (Mac / Linux)](#3-instalacja-na-komputerze-mac--linux)
4. [Pierwsze uruchomienie](#4-pierwsze-uruchomienie)
5. [Na telefonie](#5-na-telefonie)
6. [Kursy polskich bukmacherów (opcjonalnie)](#6-kursy-polskich-bukmacherów-opcjonalnie)
7. [Codzienne używanie](#7-codzienne-używanie)
8. [Aktualizacje (automatyczne)](#8-aktualizacje-automatyczne)
9. [Problemy i rozwiązania](#9-problemy-i-rozwiązania)
10. [Bezpieczeństwo i prywatność](#10-bezpieczeństwo-i-prywatność)

---

## 1. Co jest potrzebne

- Komputer z **Windows 10/11**, **macOS** albo **Linuxem** (aplikacja działa na komputerze, telefon tylko ją otwiera).
- Ok. **1 GB wolnego miejsca** i internet.
- **Node.js w wersji 22.13 lub nowszej** — darmowy program, instalacja niżej.
- **Git** — potrzebny do **automatycznych aktualizacji** (darmowy: <https://git-scm.com>; na Macu instaluje się sam przy pierwszym użyciu).
- Klucze do API **nie są potrzebne**. Opcjonalny klucz OddsPapi dodaje kursy Superbetu i Fortuny (rozdział 6).

---

## 2. Instalacja na komputerze (Windows)

### Krok 1 — zainstaluj Node.js

1. Wejdź na <https://nodejs.org> i pobierz wersję **LTS** (przycisk po lewej).
2. Uruchom pobrany plik i klikaj **Next** (ustawienia domyślne są dobre).
3. Sprawdź instalację: otwórz menu Start, wpisz **PowerShell**, uruchom i wpisz:
   ```powershell
   node -v
   ```
   Powinno się pokazać np. `v22.13.0` albo wyżej (`v24…` też jest OK).

### Krok 1b — zainstaluj Git (dla automatycznych aktualizacji)

Pobierz z <https://git-scm.com/download/win> i zainstaluj, klikając **Next** (ustawienia domyślne).

### Krok 2 — pobierz aplikację

**Sposób A (najprostszy) — plik ZIP:**
1. Na stronie projektu na GitHubie kliknij zielony przycisk **Code → Download ZIP**.
2. Rozpakuj ZIP, np. do folderu `Dokumenty\nba-track` (prawy klik → *Wyodrębnij wszystkie*).

**Sposób B — Git** (łatwiejsze aktualizacje):
```powershell
cd $HOME\Documents
git clone https://github.com/kajetanwachowski/nba-track.git
```

### Krok 3 — zainstaluj aplikację

1. Otwórz folder z aplikacją w Eksploratorze, kliknij w pasek adresu, wpisz `powershell` i naciśnij Enter
   — otworzy się PowerShell od razu w tym folderze.
2. Wpisz:
   ```powershell
   npm.cmd install
   ```
   (trwa 1–3 minuty; ostrzeżenia `npm warn` można zignorować).
3. Skopiuj plik ustawień:
   ```powershell
   copy .env.example .env.local
   ```

> **Dlaczego `npm.cmd`, a nie `npm`?** W PowerShellu samo `npm` często kończy się błędem
> *„running scripts is disabled on this system”*. `npm.cmd` działa zawsze. Możesz też raz wpisać
> `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` (potwierdź `T`/`Y`) i potem używać zwykłego `npm`.

Dalej przejdź do [rozdziału 4](#4-pierwsze-uruchomienie) (w komendach używaj `npm.cmd`).

---

## 3. Instalacja na komputerze (Mac / Linux)

1. Zainstaluj Node.js 22.13+:
   - **Mac:** pobierz wersję **LTS** z <https://nodejs.org> i zainstaluj, albo `brew install node`.
   - **Linux:** np. przez <https://github.com/nvm-sh/nvm>: `nvm install --lts`.
2. Sprawdź: `node -v` (ma być `v22.13` lub wyżej).
3. Pobierz i zainstaluj aplikację w Terminalu:
   ```bash
   cd ~/Documents
   git clone https://github.com/kajetanwachowski/nba-track.git
   cd nba-track
   npm install
   cp .env.example .env.local
   ```
   (Bez Gita: *Code → Download ZIP* na GitHubie, rozpakuj i w Terminalu wejdź do folderu poleceniem `cd`.)

---

## 4. Pierwsze uruchomienie

Wszystkie komendy wpisujesz **w folderze aplikacji** (Windows: `npm.cmd` zamiast `npm`).

### Krok 1 — przygotuj dane (tylko raz, 10–30 minut)

```bash
npm run setup
```

Aplikacja pobierze mecze i statystyki tego sezonu, a potem sprawdzi swój model na rozegranych meczach
(tzw. backtest — dzięki niemu wie, jak bardzo może ufać swoim prognozom). Na ekranie widać postęp.
Na końcu pojawi się **„Wszystko gotowe”**.

> Możesz ten krok pominąć — aplikacja zrobi to sama w tle po pierwszym uruchomieniu. Wtedy przez pierwsze
> 15–30 minut strona pokaże komunikat „Pierwsze uruchomienie…” i nie będzie jeszcze typów.

### Krok 2 — uruchom aplikację

**Najprościej — dwuklik:**
- **Windows:** plik **`Uruchom NBA EDGE.bat`** w folderze aplikacji.
- **Mac:** plik **`Uruchom NBA EDGE.command`** (za pierwszym razem: prawy klik → **Otwórz** → **Otwórz**,
  bo macOS pyta o pliki z internetu).

Albo w terminalu: `npm run serve`.

Starter sam doinstaluje brakujące rzeczy, sprawdzi aktualizacje, zbuduje i uruchomi aplikację
(pierwszy raz ok. minuty). Gdy zobaczysz **„Aplikacja działa: http://localhost:3000”**, otwórz w przeglądarce:

**<http://localhost:3000>**

Zacznij od zakładki **„Kupony i wyniki”**.

**Ważne:** okno startera musi zostać otwarte — to jest „serwer” aplikacji. Zamknięcie okna
(albo `Ctrl + C`) wyłącza aplikację. Następnym razem znowu dwuklik na „Uruchom NBA EDGE”.

> Bez automatycznych aktualizacji można też ręcznie: `npm run app` (buduje i uruchamia) albo `npm start` (już zbudowana).

---

## 5. Na telefonie

Telefon nie instaluje aplikacji — otwiera tę działającą na Twoim komputerze. Komputer musi być włączony
i mieć uruchomioną aplikację („Uruchom NBA EDGE”).

### W domu (to samo Wi-Fi)

1. **Sprawdź adres komputera w sieci:**
   - po uruchomieniu aplikacji w oknie jest linia **`Network: http://192.168.x.x:3000`** — to ten adres;
   - albo: **Windows** → w PowerShellu `ipconfig` → „Adres IPv4” przy karcie Wi-Fi;
     **Mac** → *Ustawienia systemowe → Wi-Fi → Szczegóły → Adres IP*.
2. Na telefonie (połączonym z **tym samym Wi-Fi**) wpisz w przeglądarce np. `http://192.168.1.23:3000`.
3. **Windows zapyta o zaporę** przy pierwszym uruchomieniu — zaznacz **Sieci prywatne** i kliknij **Zezwól na dostęp**.
   Jeśli okienko się nie pojawiło, a telefon nie może połączyć: *Zabezpieczenia Windows → Zapora i ochrona sieci →
   Zezwalaj aplikacji przez zaporę* → zaznacz **Node.js** (sieć prywatna).
   Mac: *Ustawienia systemowe → Sieć → Zapora* → zezwól na połączenia dla **node**.

### Ikona na ekranie (jak aplikacja)

- **iPhone (Safari):** przycisk **Udostępnij** (kwadrat ze strzałką) → **Do ekranu początkowego** → **Dodaj**.
- **Android (Chrome):** menu **⋮** → **Dodaj do ekranu głównego** (albo **Zainstaluj aplikację**).

Na ekranie pojawi się ikona **NBA EDGE**, a aplikacja otworzy się na pełnym ekranie od zakładki „Kupony i wyniki”.

> Android przy adresie `http://192.168…` czasem doda zwykłą zakładkę zamiast pełnego ekranu — to normalne
> (pełna „instalacja” wymaga adresu https, patrz niżej). Wszystko działa tak samo.

### Poza domem (na danych komórkowych)

Najprościej i bezpiecznie przez darmowy **Tailscale** (prywatna sieć tylko Twoich urządzeń):

1. Załóż konto na <https://tailscale.com> i zainstaluj aplikację **na komputerze i na telefonie** (zaloguj się tym samym kontem).
2. W aplikacji Tailscale na komputerze sprawdź jego adres (np. `100.101.102.103`).
3. Na telefonie (z włączonym Tailscale) otwórz `http://100.101.102.103:3000`.

**Nie wystawiaj aplikacji publicznie w internecie** (np. przez publiczne tunele): każdy z linkiem mógłby
klikać „Pobierz kursy” i zużywać Twój limit OddsPapi.

---

## 6. Kursy polskich bukmacherów (opcjonalnie)

Bez klucza aplikacja używa kursów **DraftKings** (USA) jako punktu odniesienia — typy i kupony działają,
ale kurs trzeba sprawdzić u swojego bukmachera. Z kluczem OddsPapi zobaczysz kursy **Superbetu** (i Fortuny).

1. Załóż **własne** konto na <https://oddspapi.io> (darmowy plan wystarczy na start) i skopiuj klucz API.
2. Otwórz plik **`.env.local`** w folderze aplikacji (Notatnik / TextEdit) i wklej klucz:
   ```
   ODDSPAPI_KEY=tu-wklej-swoj-klucz
   ```
3. Zapisz plik i uruchom aplikację ponownie (zamknij okno startera i znowu „Uruchom NBA EDGE”).
4. W aplikacji: zakładka **„Polskie kursy” → „Pobierz kursy”**. Raport pod przyciskiem pokazuje, co przyszło od każdego bukmachera.

Wskazówki:
- Kursy pobierają się **tylko po kliknięciu** przycisku (oszczędza limit). Jedno pobranie ≈ 1 + liczba meczów zapytań.
- Bukmacherów, których nie ma w OddsPapi (np. Betfan) albo w Twoim planie, możesz **wpisać ręcznie** na stronie „Polskie kursy”.
- Podatek 12% od stawki można uwzględnić w **Ustawieniach**.

---

## 7. Codzienne używanie

- **Uruchom** aplikację dwuklikiem na „Uruchom NBA EDGE” i otwórz <http://localhost:3000> (albo ikonę na telefonie).
- **Kupony i wyniki** — typy dnia i trzy kupony na dziś. Kupony zapisują się przed meczami i po rozpoczęciu
  pierwszego meczu są **zamrożone**; niżej, w sekcji **Wyniki**, widać na żywo stan każdego typu
  (np. „32 / 35.5 · 3. kwarta”) i rozliczenie: ✓ weszło, ✗ nie weszło, zwrot (zawodnik nie zagrał).
- **Pełna analiza z wykresami** — przycisk przy każdym typie: forma, minuty, rywal, kontuzje, rozkład wyników, „Dlaczego ten typ?”.
- **Historia typu ▶** — gotowe grafiki 1080×1920 (na stories) do pobrania jako PNG.
- Najlepiej sprawdzić typy **ok. 30 minut przed meczem** — wtedy znane są składy i kontuzje.
- Aplikacja co godzinę sama pobiera wyniki rozegranych meczów — nic nie musisz robić.

---

## 8. Aktualizacje (automatyczne)

Jeśli uruchamiasz aplikację przez **„Uruchom NBA EDGE”** (albo `npm run serve`), aktualizuje się **sama**:

- przy każdym uruchomieniu sprawdza, czy na GitHubie jest nowa wersja, i od razu ją instaluje;
- w trakcie działania sprawdza co 3 godziny, a nową wersję instaluje **tylko w dzień (10:00–20:00)** —
  mecze NBA są w Polsce w nocy, a instalacja to 1–2 minuty przerwy;
- jeśli nowa wersja z jakiegoś powodu się nie uruchomi, aplikacja **sama wraca do poprzedniej** i działa dalej;
- **Twoje ustawienia (`.env.local`) i dane (folder `data`) nie są ruszane.**

Aktualną wersję i datę ostatniego sprawdzenia widać w **Ustawieniach → Wersja i aktualizacje**.

Szczegóły:
- Aplikacja pobrana jako **ZIP** sama podłączy się do GitHuba przy pierwszym uruchomieniu (wymaga zainstalowanego Gita).
- Jeśli zmienisz ręcznie pliki aplikacji, automatyczna aktualizacja się wstrzyma (żeby nie skasować Twoich zmian).
- Wyłączenie: dopisz `AUTO_UPDATE=0` w `.env.local`. Częstotliwość: `UPDATE_CHECK_HOURS=6`.
- Ręcznie: `git pull`, `npm install`, `npm run app`.

Raz na jakiś czas warto odświeżyć model: `npm run backtest` (kilka minut; aplikacja może w tym czasie działać).

## 9. Problemy i rozwiązania

| Problem | Rozwiązanie |
|---|---|
| `npm : … running scripts is disabled` (Windows) | Używaj `npm.cmd …` albo raz: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`. |
| `'node' is not recognized` / `command not found: node` | Node.js nie jest zainstalowany albo trzeba otworzyć nowe okno PowerShella/Terminala po instalacji. |
| Błąd o `node:sqlite` / „SQLite” | Za stara wersja Node.js — zainstaluj aktualną LTS (min. 22.13). Ostrzeżenie *„SQLite is an experimental feature”* jest normalne. |
| `Port 3000 is in use` / `EADDRINUSE` | Aplikacja już działa w innym oknie — zamknij je albo ustaw inny port: dopisz `PORT=3001` w `.env.local` (wtedy adres to `http://localhost:3001`). |
| Strona: „Pierwsze uruchomienie…”, brak typów | Dane wciąż się przygotowują (15–30 min) albo uruchom `npm run setup`. |
| „System nie znalazł zakładów Najlepsze/Dobre” | To normalne w niektóre dni — model nie poleca na siłę. Kupony i typy dnia nadal są w „Kupony i wyniki”. |
| Telefon nie otwiera strony | Ten sam Wi-Fi? Dobry adres (`http://`, a nie `https://`, i `:3000` na końcu)? Zapora — rozdział 5. Komputer nie śpi? |
| „Superbet: brak kursów” | Zobacz raport na stronie „Polskie kursy” — mówi, czy OddsPapi przysłało kursy. Czasem trzeba spróbować za kilkanaście minut; można też wpisać kurs ręcznie. |
| Starter pisze „Nie mogę sprawdzić aktualizacji” | Brak internetu albo dostępu do repozytorium. Aplikacja i tak działa — zaktualizuje się, gdy połączenie wróci. Jeśli repozytorium jest prywatne, Git poprosi o zalogowanie do GitHuba (konto musi mieć dostęp). |
| Mac: „nie można otworzyć, pochodzi od niezidentyfikowanego dewelopera” | Prawy klik na „Uruchom NBA EDGE.command” → **Otwórz** → **Otwórz**. Albo w Terminalu: `npm run serve`. |
| Chcę zacząć od zera | Zamknij aplikację, usuń folder `data` i uruchom `npm run setup`. |

---

## 10. Bezpieczeństwo i prywatność

- Plik **`.env.local`** zawiera Twoje klucze — **nie wysyłaj go nikomu i nie wrzucaj na GitHub** (jest wykluczony w `.gitignore`).
  Jeśli klucz wyciekł, wygeneruj nowy na stronie dostawcy.
- Każda osoba powinna mieć **własny** klucz OddsPapi (limit zapytań jest na klucz).
- Wszystkie dane (mecze, wyniki, Twoje kursy) są zapisywane **tylko na Twoim komputerze** w folderze `data`.
- Aplikacja niczego nie stawia za Ciebie i nie łączy się z kontem u bukmachera.

---

**Dla zaawansowanych:** jak działa model, skąd są dane, jak wygląda backtest i jakie są wyniki —
[docs/JAK-DZIALA.md](docs/JAK-DZIALA.md). Przydatne komendy: `npm test` (testy), `npm run backtest -- --tune`
(dobór parametrów modelu), `npm run dev` (tryb deweloperski), `NBA_EDGE_NO_BACKGROUND=1` (wyłącza pracę w tle).

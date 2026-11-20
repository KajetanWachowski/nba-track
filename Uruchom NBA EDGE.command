#!/bin/bash
# Dwuklik na Macu: uruchamia NBA EDGE z automatycznymi aktualizacjami.
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Brak Node.js. Zainstaluj wersję LTS z https://nodejs.org i uruchom ponownie."
  read -r -p "Naciśnij Enter, aby zamknąć…"
  exit 1
fi
node scripts/run.mjs

#!/usr/bin/env bash
# Führt einen Befehl aus. Schlägt er fehl, erscheinen die letzten Ausgabezeilen als
# Fehler-Annotation direkt am Lauf (Zusammenfassung und Checks), ohne das Log herunterzuladen.
#
#   .github/scripts/run-annotated.sh "Titel" befehl arg …
set -uo pipefail

title=$1
shift
log=$(mktemp)
"$@" 2>&1 | tee "$log"
status=${PIPESTATUS[0]}
if [ "$status" -ne 0 ]; then
  # Farbcodes entfernen, Sonderzeichen für Workflow-Befehle kodieren, Zeilen mit %0A verbinden
  msg=$(tail -n 80 "$log" | sed -e 's/\x1b\[[0-9;]*[A-Za-z]//g' -e 's/\r$//' -e 's/%/%25/g' | awk 'BEGIN { ORS = "%0A" } { print }')
  echo "::error title=${title}::${msg}"
fi
rm -f "$log"
exit "$status"

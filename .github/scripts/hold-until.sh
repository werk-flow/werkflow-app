#!/usr/bin/env bash
# One leg of the hold in .github/workflows/release.yml. Usage: hold-until.sh <HH:MM, Berlin time>
#
# Waits for the next <HH:MM> in Berlin, for at most LEG seconds, because a job lasts 6 hours at most.
# A run further than WINDOW from that time has missed it, so it goes on at once.
set -euo pipefail

readonly LEG=$((345 * 60)) WINDOW=$((11 * 3600))

now="$(date +%s)"
# Python knows Berlin's clock changes, so the time stays right in summer and in winter.
target="$(python3 -c '
import sys
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

now = datetime.fromtimestamp(int(sys.argv[1]), ZoneInfo("Europe/Berlin"))
hour, minute = map(int, sys.argv[2].split(":"))
target = now.replace(hour=hour, minute=minute, second=0)
print(int((target if target > now else target + timedelta(days=1)).timestamp()))
' "$now" "$1")"

left=$((target - now))
if test "$left" -gt "$WINDOW"; then
  echo "$1 Berlin has passed; the run goes on now."
  exit 0
fi
hold=$((left < LEG ? left : LEG))
echo "Holding ${hold} of the ${left} seconds until $1 Berlin."
sleep "$hold"

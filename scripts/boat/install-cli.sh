#!/usr/bin/env bash
# Installs the pinned Boat CLI into ~/.local/bin for the owner's manual inspection
# (docs/technical/boat-verification.md). Runs need no CLI. Never run `boat login` on a workstation:
# it writes the key in plain text into the CLI's config.
set -euo pipefail

version=1.0.92
case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) platform=linux-x64 sum=7662f8f2c6bf31435d4d365581ebd6b84076b4a40002e3910520082a24841721 ;;
  Darwin-arm64) platform=darwin-arm64 sum=6c42401e91fc0b1ea744ec02ba4be845d0619a365caca1d9e6393b901e87fb0e ;;
  Darwin-x86_64) platform=darwin-x64 sum=052e773b661fb1a4edf151bc0062487cb74b20c16483a58d48a71c77c8876a5c ;;
  *) echo "No pinned Boat CLI for $(uname -s) $(uname -m)." >&2; exit 1 ;;
esac
folder="$(mktemp -d)"
trap 'rm -rf "$folder"' EXIT
curl -fsSL -o "$folder/boat" \
  "https://github.com/ariana-dot-dev/agent-server/releases/download/boat-cli-v$version/boat-$platform"
if command -v sha256sum > /dev/null; then actual="$(sha256sum "$folder/boat" | cut -d' ' -f1)"; else actual="$(shasum -a 256 "$folder/boat" | cut -d' ' -f1)"; fi
[ "$actual" = "$sum" ] || { echo "Checksum mismatch for boat $version ($platform): $actual" >&2; exit 1; }
mkdir -p ~/.local/bin
install -m 755 "$folder/boat" ~/.local/bin/boat
echo "Installed boat $version. Set BOAT_NO_UPDATE=1 when you run it, so it keeps this version."

#!/bin/sh
# Downloads four CC0 medieval tracks by RandomMind from OpenGameArt (loop versions) into art/.music and converts them
# to 96 kbit/s MP3 in packages/client/public/music/. Needs Docker (ffmpeg in a throwaway Alpine container).
# The downloads are not committed; the converted tracks are. Licence: CC0 (each track's page on opengameart.org).
set -eu
cd "$(dirname "$0")"
mkdir -p .music
OUT=../packages/client/public/music
mkdir -p "$OUT"
fetch() { [ -f ".music/$1.wav" ] || curl -sSfL -o ".music/$1.wav" "https://opengameart.org/sites/default/files/$2"; }
fetch bards_tale Loop_The_Bards_Tale.wav
fetch old_tower_inn Loop_The_Old_Tower_Inn.wav
fetch kings_feast Loop_Kings_Feast_0.wav
fetch minstrel_dance Loop_Minstrel_Dance_0.wav
docker run --rm -v "$PWD/.music:/in:ro" -v "$(cd "$OUT" && pwd):/out" alpine:3.20 sh -c "apk add -q --no-progress ffmpeg >/dev/null && \
  for f in bards_tale old_tower_inn kings_feast minstrel_dance; do ffmpeg -loglevel error -y -i /in/\$f.wav -b:a 96k /out/\$f.mp3; done && chown -R $(id -u):$(id -g) /out"
cat > "$OUT/CREDITS.txt" <<'TXT'
Music: "The Bard's Tale", "The Old Tower Inn", "King's Feast" and "Minstrel Dance" by RandomMind
(https://opengameart.org/users/randommind), released under CC0 1.0 (public domain). Loop versions, converted to MP3.
TXT

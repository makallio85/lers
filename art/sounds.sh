#!/bin/sh
# Downloads Kenney's CC0 audio packs (https://kenney.nl) into art/.audio and converts the sounds the game uses into
# small mono MP3 files in packages/client/public/sound/, named <sound>_<variant>.mp3. Needs Docker (ffmpeg runs in a
# throwaway Alpine container). The packs are not committed; the converted sounds are.
set -eu
cd "$(dirname "$0")"
mkdir -p .audio && cd .audio
fetch() {
  name=$1; url=$2
  [ -d "$name" ] && return
  curl -sSfL -o "$name.zip" "$url"
  mkdir "$name" && (cd "$name" && unzip -q "../$name.zip") && rm "$name.zip"
  grep -q 'CC0' "$name/License.txt" || { echo "$name: licence is not CC0" >&2; exit 1; }
}
fetch rpg-audio https://kenney.nl/media/pages/assets/rpg-audio/8e99002d76-1677590336/kenney_rpg-audio.zip
fetch impact-sounds https://kenney.nl/media/pages/assets/impact-sounds/87b4ddecda-1677589768/kenney_impact-sounds.zip
fetch interface-sounds https://kenney.nl/media/pages/assets/interface-sounds/fa43c1dd4d-1677589452/kenney_interface-sounds.zip
cd ..
OUT=../packages/client/public/sound
mkdir -p "$OUT"
# sound name, then its source files (variants), as "name:file file ...".
LIST='chop:impactWood_medium_000 impactWood_medium_001 impactWood_medium_002
hammer:impactPlank_medium_000 impactPlank_medium_001 impactPlank_medium_002
pick:impactMining_000 impactMining_001 impactMining_002
dig:impactSoft_medium_000 impactSoft_medium_001 impactSoft_medium_002
clash:impactMetal_light_000 impactMetal_light_001 impactMetal_light_002
bow:drawKnife1 drawKnife2
fall:impactSoft_heavy_000 impactSoft_heavy_001
collapse:impactWood_heavy_000 impactWood_heavy_001 impactWood_heavy_002
siege:impactPlate_heavy_000 impactPlate_heavy_001
built:confirmation_002
place:drop_002
click:click_002
error:error_004
alert:bong_001
victory:confirmation_004
defeat:error_008'
CMDS=""
NL='
'
while IFS=: read -r name files; do
  k=0
  for f in $files; do
    src=$(find .audio -name "$f.ogg" | head -1)
    [ -n "$src" ] || { echo "missing $f" >&2; exit 1; }
    CMDS="${CMDS}ffmpeg -loglevel error -y -i '/in/${src#.audio/}' -ac 1 -b:a 64k /out/${name}_$k.mp3${NL}"
    k=$((k + 1))
  done
done <<LIST_END
$LIST
LIST_END
printf '%s' "$CMDS" > .audio/convert.sh
docker run --rm -v "$PWD/.audio:/in:ro" -v "$(cd "$OUT" && pwd):/out" alpine:3.20 sh -c "apk add -q --no-progress ffmpeg >/dev/null && sh -e /in/convert.sh"
cp .audio/rpg-audio/License.txt "$OUT/LICENSE-kenney.txt"

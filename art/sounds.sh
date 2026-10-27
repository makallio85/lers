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
# sound name, then its source files (variants), as "name:file file ...". A variant may mix several files:
# file+file@ms*volume starts each part that many milliseconds in, at that volume (both optional); a trailing ~ms
# cuts the mix to that length, fading out over its last 150 ms.
LIST='chop:impactWood_medium_000 impactWood_medium_001 impactWood_medium_002
hammer:impactPlank_medium_000 impactPlank_medium_001 impactPlank_medium_002
pick:impactMining_000 impactMining_001 impactMining_002
dig:footstep_snow_000+footstep_concrete_000*0.5+impactSoft_medium_000@330 footstep_snow_002+footstep_concrete_002*0.5+impactSoft_medium_001@310 footstep_snow_004+footstep_concrete_004*0.5+impactSoft_medium_002@350
clash:impactMetal_heavy_000+impactMetal_medium_000@35*0.7+impactBell_heavy_000@10*0.15~600 impactMetal_heavy_002+impactMetal_medium_002@30*0.7+impactBell_heavy_002@10*0.15~600 impactMetal_heavy_004+impactMetal_medium_004@40*0.7+impactBell_heavy_004@10*0.15~600
thrust:knifeSlice*0.5+impactWood_light_000@120+impactMetal_light_000@140*0.5 knifeSlice2*0.5+impactWood_light_002@110+impactMetal_light_002@130*0.5 knifeSlice*0.5+impactWood_light_004@130+impactMetal_light_004@150*0.5
bow:pluck_001+drawKnife3@60*2.5+impactSoft_medium_003@420*0.35 pluck_002+drawKnife1@60*4+impactSoft_medium_004@440*0.35
fall:impactSoft_heavy_000 impactSoft_heavy_001
collapse:creak1*0.8+impactWood_heavy_000@250+impactSoft_heavy_000@450+impactMining_000@600*0.7+impactPlank_medium_003@900*0.6 creak2*0.8+impactWood_heavy_001@300+impactSoft_heavy_001@500+impactMining_002@650*0.7+impactPlank_medium_001@950*0.6 creak3*0.8+impactWood_heavy_002@200+impactSoft_heavy_002@420+impactMining_004@580*0.7+impactPlank_medium_004@850*0.6
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
  for variant in $files; do
    inputs=""; filters=""; mix=""; n=0; cut=""
    case $variant in *~*) len=${variant##*~}; variant=${variant%~*}; cut=",atrim=end=${len}ms,afade=t=out:st=$((len - 150))ms:d=150ms";; esac
    for part in $(echo "$variant" | tr '+' ' '); do
      f=${part%%[@*]*}; delay=0; vol=1
      case $part in *@*) delay=${part#*@}; delay=${delay%%\**};; esac
      case $part in *\**) vol=${part#*\*}; vol=${vol%%@*};; esac
      src=$(find .audio -name "$f.ogg" | head -1)
      [ -n "$src" ] || { echo "missing $f" >&2; exit 1; }
      inputs="$inputs -i '/in/${src#.audio/}'"
      filters="$filters[$n:a]aformat=channel_layouts=mono,adelay=$delay,volume=$vol[p$n];"
      mix="$mix[p$n]"
      n=$((n + 1))
    done
    if [ "$n" -eq 1 ] && [ "$delay" = 0 ] && [ "$vol" = 1 ] && [ -z "$cut" ]; then
      CMDS="${CMDS}ffmpeg -loglevel error -y${inputs} -ac 1 -b:a 64k /out/${name}_$k.mp3${NL}"
    else
      CMDS="${CMDS}ffmpeg -loglevel error -y${inputs} -filter_complex '${filters}${mix}amix=inputs=$n:normalize=0:duration=longest${cut},alimiter=limit=0.89' -ac 1 -b:a 64k /out/${name}_$k.mp3${NL}"
    fi
    k=$((k + 1))
  done
done <<LIST_END
$LIST
LIST_END
printf '%s' "$CMDS" > .audio/convert.sh
# SOUNDS_DRY=1 stops here, leaving the ffmpeg commands in .audio/convert.sh.
[ "${SOUNDS_DRY:-}" = 1 ] && exit 0
docker run --rm -v "$PWD/.audio:/in:ro" -v "$(cd "$OUT" && pwd):/out" alpine:3.20 sh -c "apk add -q --no-progress ffmpeg >/dev/null && sh -e /in/convert.sh && chown -R $(id -u):$(id -g) /out"
cp .audio/rpg-audio/License.txt "$OUT/LICENSE-kenney.txt"

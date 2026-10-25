#!/bin/sh
# Downloads the CC0 3D kits by Kenney (https://kenney.nl) that the art scripts build from.
# The kits are not committed; run this once before rendering.
set -eu
cd "$(dirname "$0")"
mkdir -p .kits && cd .kits
fetch() {
  name=$1; url=$2
  [ -d "$name" ] && return
  echo "fetching $name"
  curl -sSfL -o "$name.zip" "$url"
  mkdir "$name" && (cd "$name" && unzip -q "../$name.zip") && rm "$name.zip"
  grep -q 'CC0' "$name/License.txt" || { echo "$name: licence is not CC0" >&2; exit 1; }
}
fetch town https://kenney.nl/media/pages/assets/fantasy-town-kit/efe948d309-1754222374/kenney_fantasy-town-kit_2.0.zip
fetch castle https://kenney.nl/media/pages/assets/castle-kit/a395102d20-1711543616/kenney_castle-kit.zip
fetch survival https://kenney.nl/media/pages/assets/survival-kit/4065a8185b-1712149243/kenney_survival-kit.zip
fetch nature https://kenney.nl/media/pages/assets/nature-kit/37ac38a37b-1677698939/kenney_nature-kit.zip
fetch characters https://kenney.nl/media/pages/assets/mini-characters/bfc7e272b4-1774770718/kenney_mini-characters.zip

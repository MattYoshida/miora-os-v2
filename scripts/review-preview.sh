#!/bin/sh
# 720p 9:16 faststart preview for /review.
#
# The app plays ads.media.preview (Storage path previews/<ad id>.mp4 in bucket miora-media)
# and only falls back to the finished 9x16 master when that object is missing. Masters in
# this project are often 50–400 MB. Existing previews stay where they are; this does not
# rewrite them. Run it for an ad that has no preview, or when you re-cut one.
#
#   scripts/review-preview.sh <ad id> <source.mp4> [out.mp4]
#
# Then upload the mp4 to miora-media at previews/<ad id>.mp4 (cache-control max-age=86400)
# and set ads.media.preview to:
#   {"bucket":"miora-media","path":"previews/<ad id>.mp4","bytes":<size>}
# The Mac job that already writes previews/<id>.mp4 can keep doing that. Add
# -movflags +faststart so the moov atom is at the front (playback can start without
# reading the end of the file).

set -eu
if [ $# -lt 2 ]; then
  echo "usage: scripts/review-preview.sh <ad id> <source.mp4> [out.mp4]" >&2
  exit 2
fi
id=$1
in=$2
out=${3:-previews/$id.mp4}
mkdir -p "$(dirname "$out")"
ffmpeg -y -i "$in" \
  -vf "scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2:black" \
  -c:v libx264 -profile:v main -pix_fmt yuv420p -crf 28 -preset veryfast -movflags +faststart \
  -c:a aac -b:a 96k -ac 2 \
  "$out"
python3 - "$out" << 'PY'
import sys
path = sys.argv[1]
buf = open(path, "rb").read()
i, names = 0, []
while i + 8 <= len(buf):
    size = int.from_bytes(buf[i:i + 4], "big")
    typ = buf[i + 4:i + 8].decode("latin1")
    if size < 8:
        break
    names.append(typ)
    i += size
print(path, "bytes", len(buf))
print("atoms:", " ".join(names))
if "moov" not in names or "mdat" not in names or names.index("moov") > names.index("mdat"):
    sys.exit("not faststart: moov is missing or sits after mdat")
print("faststart: yes")
PY

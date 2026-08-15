#!/bin/sh
set -e
if [ "$1" = configure ]; then
  if [ -e /usr/local/bin/mathion ]; then
    echo "mathion: a curl|sh copy at /usr/local/bin/mathion will shadow this apt package" >&2
    echo "mathion: on the default PATH; remove it (sudo rm /usr/local/bin/mathion) to use apt." >&2
  fi
fi
exit 0

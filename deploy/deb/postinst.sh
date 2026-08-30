#!/bin/sh
set -e
if [ "$1" = configure ]; then
  if [ -e /usr/local/bin/mathion ]; then
    echo "mathion: a curl|sh copy at /usr/local/bin/mathion will shadow this apt package" >&2
    echo "mathion: on the default PATH; remove it (sudo rm /usr/local/bin/mathion) to use apt." >&2
  fi
  # Precise, file-only drift notice (spec §4.3). SKIPPED when a curl|sh copy may shadow
  # the apt binary. timeout --kill-after is load-bearing: plain `timeout` only sends
  # SIGTERM and would wait forever on a child that ignores it; --kill-after escalates to
  # SIGKILL so this can never wedge dpkg. `|| true` + the `exit 0` floor keep configure
  # green regardless. (The [ ] && [ ] is an if-condition and `timeout … || true` is A||C,
  # both SC2015-exempt.)
  if [ ! -e /usr/local/bin/mathion ] && [ -x /usr/bin/mathion ]; then
    timeout --kill-after=1s 5s /usr/bin/mathion _drift-probe 2>/dev/null || true
  fi
fi
exit 0

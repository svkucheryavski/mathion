#!/bin/sh
# Tests the installer's hand-off to `mathion install` (offer_setup); no root, no network.
set -eu
# shellcheck disable=SC1007  # CDPATH= is a deliberate one-command env prefix
ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
W="$(mktemp -d)"
trap 'rm -rf "$W"' EXIT

MATHION_INSTALL_LIB=1
# shellcheck source=deploy/install.sh
. "$ROOT_DIR/deploy/install.sh"

fail() { echo "FAIL: $*"; exit 1; }

# The stub mathion: `install --help` prints $W/help; `install` records its args and its second stdin line.
cat >"$W/stub" <<'EOF'
#!/bin/sh
d="$(dirname "$0")"
if [ "${2:-}" = "--help" ]; then cat "$d/help"; exit 0; fi
IFS= read -r _ || true
IFS= read -r second || second=""
printf '%s|%s\n' "$*" "$second" >"$d/ran"
EOF
chmod +x "$W/stub"
DEST="$W/stub"
NEW_HELP='      --no-tls    do not set up the bundled HTTPS proxy'
NEXT='Next: sudo mathion install   (it asks for the site address and your email)'
OLD_NEXT='Next: sudo mathion install --domain <your-domain> --admin-email <you@example.edu>'
QUESTION='Set up Mathion on this server now? [Y/n]'
mkdir "$W/cfg" "$W/fresh" "$W/link"

# run NAME TTY-CONTENT: offer_setup in a subshell (yes ends in exec), output in $W/out.
run() {
  rm -f "$W/ran"
  printf '%b' "$2" >"$W/tty"
  (offer_setup) </dev/null >"$W/out" 2>&1 || fail "$1: offer_setup exited non-zero: $(cat "$W/out")"
}
has() { grep -qF -- "$2" "$W/out" || fail "$1: output lacks '$2': $(cat "$W/out")"; }
lacks() { ! grep -qF -- "$2" "$W/out" || fail "$1: output has '$2': $(cat "$W/out")"; }
# installed NAME: install ran once with the tty as stdin, the downloads were removed, nothing followed.
installed() {
  [ "$(cat "$W/ran" 2>/dev/null)" = "install|MARK" ] || fail "$1: want install with the tty as stdin, got '$(cat "$W/ran" 2>/dev/null)'"
  [ ! -e "$TMP" ] || fail "$1: the download folder was left behind"
  [ "$(grep -cF -- "$QUESTION" "$W/out")" = 1 ] || fail "$1: the question was asked again: $(cat "$W/out")"
  lacks "$1" "Next:"
}
not_ran() { [ ! -e "$W/ran" ] || fail "$1: mathion install ran: $(cat "$W/ran")"; }

printf '%s\n' "$NEW_HELP" >"$W/help"
MATHION_TTY="$W/tty"
TMP="$W/dl"

# 0. main hands over at its end.
grep -q '^  offer_setup$' "$ROOT_DIR/deploy/install.sh" || fail "main does not call offer_setup"

# 1. Already set up: no question, no install.
touch "$W/cfg/.env"
MATHION_CONFIG_DIR="$W/cfg"
run existing '\n'
has existing 'Mathion is already set up here. Update with: sudo mathion self-update && sudo mathion update'
not_ran existing

# 1b. A broken .env link also counts (install would refuse it).
ln -s "$W/nowhere" "$W/link/.env"
MATHION_CONFIG_DIR="$W/link"
run link '\n'
has link 'Mathion is already set up here.'
not_ran link

MATHION_CONFIG_DIR="$W/fresh"

# 2. An older mathion without the new install: print the command instead.
printf 'Usage: mathion install [flags]\n' >"$W/help"
run old-cli '\n'
has old-cli "$OLD_NEXT"
not_ran old-cli
printf '%s\n' "$NEW_HELP" >"$W/help"

# 3. No terminal to ask on.
MATHION_TTY="$W/no-such-tty"
run no-tty ''
has no-tty "$NEXT"
not_ran no-tty
MATHION_TTY="$W/tty"

# 4. Enter means yes: install runs with the terminal as its input.
for answer in '' 'y' 'Y' 'YES' ' y '; do
  mkdir -p "$TMP"
  run "yes '$answer'" "$answer\nMARK\n"
  installed "yes '$answer'"
done

# 6. n means no.
for answer in 'n' 'No'; do
  run "no '$answer'" "$answer\n"
  has "no '$answer'" "$NEXT"
  not_ran "no '$answer'"
done

# 7. Input ended before an answer: treated as no.
run eof ''
has eof "$NEXT"
not_ran eof

# 8. Anything else asks again.
run again 'maybe\nn\n'
has again 'Please answer y or n.'
has again "$NEXT"
not_ran again

echo "PASS: installer hand-off"

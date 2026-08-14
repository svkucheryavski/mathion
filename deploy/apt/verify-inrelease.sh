#!/bin/sh
# verify-inrelease.sh <clearsigned-InRelease> <trusted-apt-keyring.asc> <allowed-S_apt-fprs> <out-body>
# <allowed-S_apt-fprs> is a SPACE-SEPARATED allowlist (one fpr steady-state; the
# outgoing+incoming pair during a rotation overlap — §6.1). Exit 0 and write the VERIFIED
# Release payload to <out-body> iff the file carries a GOODSIG by an ALLOWED S_apt subkey
# with NO expired/revoked/bad status AND gpg itself exited 0. gpg's EXIT CODE is 0 for
# EXPKEYSIG/REVKEYSIG (a still-"valid" sig by an expired/revoked key) — caught by the
# status policy — but a NONZERO exit must still fail closed. Verifies in a clean GNUPGHOME
# built ONLY from the trusted keyring (never the ambient signing keyring); the body is
# staged and only published to <out-body> after acceptance.
set -eu
FILE="$1"; KEYRING="$2"; FPRS="$3"; OUT="$4"
vh="$(mktemp -d)"; chmod 700 "$vh"
trap 'rm -rf "$vh"' EXIT
GNUPGHOME="$vh" gpg --batch --no-tty --import "$KEYRING" >/dev/null 2>&1 \
  || { echo "verify-inrelease: cannot import trusted apt keyring" >&2; exit 1; }
rc=0
st="$(GNUPGHOME="$vh" gpg --batch --no-tty --status-fd 1 --output "$vh/body" --decrypt "$FILE" 2>/dev/null)" || rc=$?
[ "$rc" = 0 ] || { echo "verify-inrelease: gpg exited $rc (unverified/tampered/no-pubkey)" >&2; exit 1; }
printf '%s\n' "$st" | grep -q '^\[GNUPG:\] GOODSIG' \
  || { echo "verify-inrelease: no GOODSIG (unsigned/tampered/expired/revoked)" >&2; exit 1; }
if printf '%s\n' "$st" | grep -Eq '^\[GNUPG:\] (EXPKEYSIG|REVKEYSIG|EXPSIG|ERRSIG|BADSIG)'; then
  echo "verify-inrelease: expired/revoked/bad S_apt signature" >&2; exit 1; fi
vsfpr="$(printf '%s\n' "$st" | awk '/^\[GNUPG:\] VALIDSIG /{print $3; exit}')"
# reject an EMPTY VALIDSIG fpr explicitly — otherwise a malformed allowlist with adjacent
# spaces (e.g. "A  B") could match the empty value in the case below. (GOODSIG above already
# implies a VALIDSIG in practice, so this is defense-in-depth on the STATED policy.)
[ -n "$vsfpr" ] || { echo "verify-inrelease: no VALIDSIG fingerprint in status output" >&2; exit 1; }
case " $FPRS " in
  *" $vsfpr "*) : ;;
  *) echo "verify-inrelease: not signed by an allowed S_apt subkey ($vsfpr)" >&2; exit 1 ;;
esac
cp "$vh/body" "$OUT"   # publish the verified body ONLY after full acceptance

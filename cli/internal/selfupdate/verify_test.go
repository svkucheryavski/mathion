package selfupdate

import (
	"bytes"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/ProtonMail/go-crypto/openpgp"
	"github.com/ProtonMail/go-crypto/openpgp/packet"
)

// newSigner returns a throwaway entity with a signing subkey and its public keyring.
func newSigner(t *testing.T) (*openpgp.Entity, openpgp.EntityList) {
	t.Helper()
	e, err := openpgp.NewEntity("Test", "", "t@example.invalid", nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := e.AddSigningSubkey(nil); err != nil {
		t.Fatal(err)
	}
	return e, entityKeyring(t, e)
}

// entityKeyring serializes e's PUBLIC half and reads it back as a keyring (what
// self-update verifies against). Shared by the expired/revoked cases below.
func entityKeyring(t *testing.T, e *openpgp.Entity) openpgp.EntityList {
	t.Helper()
	var pub bytes.Buffer
	if err := e.Serialize(&pub); err != nil { // public entity only
		t.Fatal(err)
	}
	kr, err := openpgp.ReadKeyRing(&pub)
	if err != nil {
		t.Fatal(err)
	}
	return kr
}

func armoredSig(t *testing.T, signer *openpgp.Entity, msg []byte) []byte {
	return armoredSigConfig(t, signer, msg, nil)
}

// armoredSigConfig signs with an explicit config — needed to sign AS-OF a past
// time for the expired-key case, when the key was still valid.
func armoredSigConfig(t *testing.T, signer *openpgp.Entity, msg []byte, cfg *packet.Config) []byte {
	t.Helper()
	var asc bytes.Buffer
	if err := openpgp.ArmoredDetachSign(&asc, signer, bytes.NewReader(msg), cfg); err != nil {
		t.Fatal(err)
	}
	return asc.Bytes()
}

// signingSubkey returns the index of e's signing-capable subkey. NewEntity adds
// an ENCRYPTION subkey at index 0, so the signer is not necessarily Subkeys[0] —
// revoking the wrong subkey silently passes verification (learned empirically).
func signingSubkey(t *testing.T, e *openpgp.Entity) int {
	t.Helper()
	for i := range e.Subkeys {
		if s := e.Subkeys[i].Sig; s != nil && s.FlagsValid && s.FlagSign {
			return i
		}
	}
	t.Fatal("no signing subkey")
	return -1
}

func TestVerifyChecksums(t *testing.T) {
	relEntity, relKR := newSigner(t) // "S_rel" — its subkey IS in the verifying keyring
	aptEntity, _ := newSigner(t)     // foreign key (S_apt analog) — NOT in relKR
	sums := []byte("abc123  mathion_linux_amd64.tar.gz\n")

	if err := verifyChecksums(relKR, sums, armoredSig(t, relEntity, sums)); err != nil {
		t.Fatalf("valid S_rel signature must verify: %v", err)
	}
	if err := verifyChecksums(relKR, sums, armoredSig(t, aptEntity, sums)); err == nil {
		t.Fatal("a signature from a key outside the trimmed keyring must be rejected")
	}
	if err := verifyChecksums(relKR, []byte("tampered  x\n"), armoredSig(t, relEntity, sums)); err == nil {
		t.Fatal("a signature over different bytes must be rejected")
	}
	bad := armoredSig(t, relEntity, sums)
	bad[len(bad)/2] ^= 0xFF // corrupt the armored signature
	if err := verifyChecksums(relKR, sums, bad); err == nil {
		t.Fatal("a corrupted .asc must be rejected")
	}
}

// §9.1 signature negatives beyond wrong-key/tampered. go-crypto's
// VerifyDetachedSignatureAndHash rejects BOTH expired and revoked signing subkeys
// NATIVELY ("key expired" / "signature made by revoked key") — verifyChecksums
// needs NO membership-loop change; the tests just have to target the SIGNING subkey.
func TestVerifyChecksums_ExpiredKey(t *testing.T) {
	sums := []byte("abc123  mathion_linux_amd64.tar.gz\n")
	past := time.Date(2001, 1, 1, 0, 0, 0, 0, time.UTC)
	cfg := &packet.Config{Time: func() time.Time { return past }, KeyLifetimeSecs: 3600}
	e, err := openpgp.NewEntity("Expired", "", "e@example.invalid", cfg)
	if err != nil {
		t.Fatal(err)
	}
	if err := e.AddSigningSubkey(cfg); err != nil {
		t.Fatal(err)
	}
	kr := entityKeyring(t, e)
	sig := armoredSigConfig(t, e, sums, cfg) // signed when the key was still valid
	if err := verifyChecksums(kr, sums, sig); err == nil {
		t.Fatal("a signature by an expired signing subkey must be rejected")
	}
}

func TestVerifyChecksums_RevokedKey(t *testing.T) {
	sums := []byte("abc123  mathion_linux_amd64.tar.gz\n")
	e, err := openpgp.NewEntity("Revoked", "", "r@example.invalid", nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := e.AddSigningSubkey(nil); err != nil {
		t.Fatal(err)
	}
	i := signingSubkey(t, e)
	sig := armoredSig(t, e, sums) // sign BEFORE revoking
	if err := e.RevokeSubkey(&e.Subkeys[i], packet.NoReason, "rotated out", nil); err != nil {
		t.Fatal(err)
	}
	kr := entityKeyring(t, e)
	if err := verifyChecksums(kr, sums, sig); err == nil {
		t.Fatal("a signature by a revoked signing subkey must be rejected")
	}
}

// §6.1 correction 5: an untrimmed keyring carrying TWO signing subkeys (e.g. a full
// export that swept in S_apt) must be refused before any signature check — the
// assertSingleSigningSubkey guard fires first, so even a bogus .asc never reaches
// armor.Decode. NewEntity adds an ENCRYPTION subkey at index 0; two AddSigningSubkey
// calls give exactly two SIGNING subkeys.
func TestVerifyChecksums_RejectsMultipleSigningSubkeys(t *testing.T) {
	e, err := openpgp.NewEntity("Untrimmed", "", "u@example.invalid", nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := e.AddSigningSubkey(nil); err != nil {
		t.Fatal(err)
	}
	if err := e.AddSigningSubkey(nil); err != nil {
		t.Fatal(err)
	}
	kr := entityKeyring(t, e)
	err = verifyChecksums(kr, []byte("abc  mathion_linux_amd64.tar.gz\n"), []byte("not-a-real-signature"))
	if err == nil || !strings.Contains(err.Error(), "exactly one signing subkey") {
		t.Fatalf("want single-subkey rejection before signature check, got %v", err)
	}
}

func TestChecksumFor(t *testing.T) {
	body := []byte("deadbeef  mathion_linux_amd64.tar.gz\nfeedface  other\n")
	got, err := checksumFor(body, "mathion_linux_amd64.tar.gz")
	if err != nil || got != "deadbeef" {
		t.Fatalf("exactly-one: got %q err %v", got, err)
	}
	if _, err := checksumFor(body, "absent.tar.gz"); err == nil {
		t.Fatal("zero matches must error")
	}
	dup := []byte("a  m.tgz\nb  m.tgz\n")
	if _, err := checksumFor(dup, "m.tgz"); err == nil {
		t.Fatal("duplicate matches must error")
	}
}

func TestEmbeddedKeyringMatchesCanonical(t *testing.T) {
	canonical, err := os.ReadFile("../../../deploy/keys/mathion-pubkey.asc")
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(canonical, embeddedKeyring) {
		t.Fatal("embedded mathion-pubkey.asc has drifted from deploy/keys/mathion-pubkey.asc")
	}
}

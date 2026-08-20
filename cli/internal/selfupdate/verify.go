package selfupdate

import (
	"bufio"
	"bytes"
	"crypto"
	_ "embed"
	"errors"
	"fmt"
	"strings"

	"github.com/ProtonMail/go-crypto/openpgp"
	"github.com/ProtonMail/go-crypto/openpgp/armor"
)

//go:embed mathion-pubkey.asc
var embeddedKeyring []byte

// allowedHashes is the EXACT digest set self-update accepts — reject SHA-1/MD5. §6.1.
var allowedHashes = []crypto.Hash{crypto.SHA256, crypto.SHA384, crypto.SHA512}

// loadKeyring parses the embedded primary + S_rel keyring. Returns an error while
// mathion-pubkey.asc is the placeholder (keygen is a 4a go-live prereq, §12); the
// injectable keyring seam (Task 8) is what tests and integration use. The
// single-signing-subkey assertion (§6.1 correction 5) rejects an untrimmed asset
// at load time — before any signature is ever checked against it.
func loadKeyring() (openpgp.EntityList, error) {
	kr, err := openpgp.ReadArmoredKeyRing(bytes.NewReader(embeddedKeyring))
	if err != nil {
		return nil, err
	}
	if err := assertSingleSigningSubkey(kr); err != nil {
		return nil, err
	}
	return kr, nil
}

// srelSubkeyFingerprints collects the fingerprints of signing-capable subkeys in
// the trimmed keyring — the ONLY fingerprints a release signature may carry. The
// primary is deliberately excluded (§6.1: never the primary, never a scalar).
func srelSubkeyFingerprints(kr openpgp.EntityList) [][]byte {
	var fps [][]byte
	for _, e := range kr {
		for _, sub := range e.Subkeys {
			if sub.Sig != nil && sub.Sig.FlagsValid && sub.Sig.FlagSign {
				fps = append(fps, sub.PublicKey.Fingerprint)
			}
		}
	}
	return fps
}

// assertSingleSigningSubkey enforces §6.1 correction 5: the verifying keyring must
// carry EXACTLY ONE signing-capable non-primary subkey. Zero means an unusable
// keyring; two or more means an untrimmed asset (e.g. a full `gpg --export` that
// swept in S_apt) that would silently widen the accepted-signer set. Called both at
// load (embedded asset) AND at the top of verifyChecksums, so an injected keyring
// (Task 8 seam) is guarded on the same path a signature is checked.
func assertSingleSigningSubkey(kr openpgp.EntityList) error {
	if n := len(srelSubkeyFingerprints(kr)); n != 1 {
		return fmt.Errorf("verifying keyring must have exactly one signing subkey, found %d", n)
	}
	return nil
}

// verifyChecksums returns nil iff sigASC is a valid detached signature over
// checksums, made by a signing subkey present in kr. Fails closed on any deviation
// (untrimmed keyring, wrong armor block, disallowed digest, bad/absent signature,
// non-member issuer).
func verifyChecksums(kr openpgp.EntityList, checksums, sigASC []byte) error {
	if err := assertSingleSigningSubkey(kr); err != nil {
		return err
	}
	block, err := armor.Decode(bytes.NewReader(sigASC))
	if err != nil {
		return fmt.Errorf("armor decode: %w", err)
	}
	if block.Type != openpgp.SignatureType {
		return fmt.Errorf("unexpected armor block %q (want %q)", block.Type, openpgp.SignatureType)
	}
	sig, _, err := openpgp.VerifyDetachedSignatureAndHash(kr, bytes.NewReader(checksums), block.Body, allowedHashes, nil)
	if err != nil {
		return fmt.Errorf("signature verify: %w", err)
	}
	if len(sig.IssuerFingerprint) == 0 {
		return errors.New("signature carries no issuer fingerprint")
	}
	for _, fp := range srelSubkeyFingerprints(kr) {
		if bytes.Equal(fp, sig.IssuerFingerprint) {
			return nil
		}
	}
	return errors.New("signature not made by an S_rel signing subkey")
}

// checksumFor returns the hex sha256 for asset, requiring EXACTLY ONE
// whitespace-delimited "<hex>  <asset>" line (zero or duplicate -> error). §4.2 step 5.
func checksumFor(checksums []byte, asset string) (string, error) {
	var hexsum string
	n := 0
	sc := bufio.NewScanner(bytes.NewReader(checksums))
	for sc.Scan() {
		f := strings.Fields(sc.Text())
		if len(f) == 2 && f[1] == asset {
			hexsum, n = f[0], n+1
		}
	}
	if err := sc.Err(); err != nil {
		return "", err
	}
	if n != 1 {
		return "", fmt.Errorf("expected exactly one checksum line for %s, found %d", asset, n)
	}
	return hexsum, nil
}

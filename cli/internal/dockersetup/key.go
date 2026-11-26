package dockersetup

import (
	"bytes"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"

	"github.com/ProtonMail/go-crypto/openpgp"
	"github.com/ProtonMail/go-crypto/openpgp/armor"
)

// DockerKeyFingerprint is Docker's apt signing key, checked against two sources on 2026-11-25.
const DockerKeyFingerprint = "9DC858229FC7DD38854AE2D88D81803C0EBFCD88"

const (
	armorBegin = "-----BEGIN PGP PUBLIC KEY BLOCK-----"
	armorEnd   = "-----END PGP PUBLIC KEY BLOCK-----"
)

// CheckKey checks a downloaded key file and returns only the checked key, armored again.
func CheckKey(armored []byte, wantFPR string) ([]byte, error) {
	s := strings.TrimSpace(string(armored))
	if !strings.HasPrefix(s, armorBegin) || !strings.HasSuffix(s, armorEnd) || strings.Count(s, armorBegin) != 1 || strings.Count(s, armorEnd) != 1 {
		return nil, errors.New("the Docker signing key file must hold exactly one key block and nothing else")
	}
	ring, err := openpgp.ReadArmoredKeyRing(bytes.NewReader(armored))
	if err != nil {
		return nil, fmt.Errorf("the Docker signing key could not be read: %w", err)
	}
	if len(ring) != 1 {
		return nil, fmt.Errorf("the Docker signing key file holds %d keys, expected 1", len(ring))
	}
	want := strings.ToUpper(wantFPR)
	if got := strings.ToUpper(hex.EncodeToString(ring[0].PrimaryKey.Fingerprint)); got != want {
		return nil, fmt.Errorf("the Docker signing key has fingerprint %s, expected %s; nothing was installed", got, want)
	}
	var buf bytes.Buffer
	w, err := armor.Encode(&buf, openpgp.PublicKeyType, nil)
	if err != nil {
		return nil, err
	}
	if err := ring[0].Serialize(w); err != nil {
		return nil, err
	}
	if err := w.Close(); err != nil {
		return nil, err
	}
	buf.WriteByte('\n')
	return buf.Bytes(), nil
}

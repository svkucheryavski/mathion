package dockersetup

import (
	"bytes"
	"encoding/hex"
	"io"
	"os"
	"strings"
	"testing"

	"github.com/ProtonMail/go-crypto/openpgp"
	"github.com/ProtonMail/go-crypto/openpgp/armor"
	"github.com/ProtonMail/go-crypto/openpgp/clearsign"
	"github.com/ProtonMail/go-crypto/openpgp/packet"
)

// dockerSigningSubkey signs Docker's repository metadata.
const dockerSigningSubkey = "7EA0A9C3F273FCD8"

func dockerKey(t *testing.T) []byte {
	t.Helper()
	b, err := os.ReadFile("testdata/docker.asc")
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func newEntity(t *testing.T) *openpgp.Entity {
	t.Helper()
	e, err := openpgp.NewEntity("Other", "", "other@example.org", &packet.Config{Algorithm: packet.PubKeyAlgoEdDSA})
	if err != nil {
		t.Fatal(err)
	}
	return e
}

// armored wraps raw packets in one public key block.
func armored(t *testing.T, raw []byte) []byte {
	t.Helper()
	var buf bytes.Buffer
	w, err := armor.Encode(&buf, openpgp.PublicKeyType, nil)
	if err != nil {
		t.Fatal(err)
	}
	w.Write(raw)
	w.Close()
	return buf.Bytes()
}

func dockerRaw(t *testing.T) []byte {
	t.Helper()
	blk, err := armor.Decode(bytes.NewReader(dockerKey(t)))
	if err != nil {
		t.Fatal(err)
	}
	raw, err := io.ReadAll(blk.Body)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func otherKey(t *testing.T) []byte {
	t.Helper()
	var raw bytes.Buffer
	if err := newEntity(t).Serialize(&raw); err != nil {
		t.Fatal(err)
	}
	return armored(t, raw.Bytes())
}

func onlyEntity(t *testing.T, key []byte) *openpgp.Entity {
	t.Helper()
	ring, err := openpgp.ReadArmoredKeyRing(bytes.NewReader(key))
	if err != nil || len(ring) != 1 {
		t.Fatalf("written key: %d entities, %v", len(ring), err)
	}
	return ring[0]
}

func TestCheckKeyAcceptsDocker(t *testing.T) {
	clean, err := CheckKey(dockerKey(t), DockerKeyFingerprint)
	if err != nil {
		t.Fatal(err)
	}
	e := onlyEntity(t, clean)
	if got := strings.ToUpper(hex.EncodeToString(e.PrimaryKey.Fingerprint)); got != DockerKeyFingerprint {
		t.Fatalf("fingerprint %s", got)
	}
	found := false
	for _, s := range e.Subkeys {
		if strings.ToUpper(s.PublicKey.KeyIdString()) == dockerSigningSubkey {
			found = true
		}
	}
	if !found {
		t.Fatal("the checked key lost Docker's signing subkey")
	}
}

func TestCheckKeyLowercaseWant(t *testing.T) {
	if _, err := CheckKey(dockerKey(t), "9dc858229fc7dd38854ae2d88d81803c0ebfcd88"); err != nil {
		t.Fatal(err)
	}
}

func TestCheckKeyRejectsOtherKey(t *testing.T) {
	if _, err := CheckKey(otherKey(t), DockerKeyFingerprint); err == nil {
		t.Fatal("a different key must be refused")
	}
}

func TestCheckKeyRejectsTwoBlocks(t *testing.T) {
	both := append(append([]byte{}, dockerKey(t)...), otherKey(t)...)
	if _, err := CheckKey(both, DockerKeyFingerprint); err == nil {
		t.Fatal("a second key block must be refused")
	}
}

func TestCheckKeyRejectsTwoKeysInOneBlock(t *testing.T) {
	var other bytes.Buffer
	if err := newEntity(t).Serialize(&other); err != nil {
		t.Fatal(err)
	}
	one := armored(t, append(dockerRaw(t), other.Bytes()...))
	if _, err := CheckKey(one, DockerKeyFingerprint); err == nil {
		t.Fatal("two keys in one block must be refused")
	}
}

func TestCheckKeyDropsWhatItCannotRead(t *testing.T) {
	var bare bytes.Buffer
	if err := newEntity(t).PrimaryKey.Serialize(&bare); err != nil {
		t.Fatal(err)
	}
	in := armored(t, append(dockerRaw(t), bare.Bytes()...))
	clean, err := CheckKey(in, DockerKeyFingerprint)
	if err != nil {
		t.Skipf("go-crypto refuses the extra packet itself: %v", err)
	}
	blk, err := armor.Decode(bytes.NewReader(clean))
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := io.ReadAll(blk.Body)
	if bytes.Contains(raw, bare.Bytes()) {
		t.Fatal("the written key still holds the packet that was not checked")
	}
	onlyEntity(t, clean)
}

func TestCheckKeyRejectsTextAround(t *testing.T) {
	for _, b := range [][]byte{
		append([]byte("junk\n"), dockerKey(t)...),
		append(append([]byte{}, dockerKey(t)...), []byte("junk\n")...),
	} {
		if _, err := CheckKey(b, DockerKeyFingerprint); err == nil {
			t.Fatal("text outside the key block must be refused")
		}
	}
}

func TestCheckKeyRejectsGarbage(t *testing.T) {
	if _, err := CheckKey([]byte("<html>not a key</html>"), DockerKeyFingerprint); err == nil {
		t.Fatal("garbage must be refused")
	}
}

func TestCheckedKeyVerifiesDockerRelease(t *testing.T) {
	clean, err := CheckKey(dockerKey(t), DockerKeyFingerprint)
	if err != nil {
		t.Fatal(err)
	}
	ring, err := openpgp.ReadArmoredKeyRing(bytes.NewReader(clean))
	if err != nil {
		t.Fatal(err)
	}
	in, err := os.ReadFile("testdata/bookworm-InRelease")
	if err != nil {
		t.Fatal(err)
	}
	b, _ := clearsign.Decode(in)
	if b == nil {
		t.Fatal("InRelease is not clearsigned")
	}
	signer, err := openpgp.CheckDetachedSignature(ring, bytes.NewReader(b.Bytes), b.ArmoredSignature.Body, nil)
	if err != nil {
		t.Fatalf("the written key does not verify Docker's InRelease: %v", err)
	}
	if signer.PrimaryKey.KeyIdString() != "8D81803C0EBFCD88" {
		t.Fatalf("signed by %s", signer.PrimaryKey.KeyIdString())
	}
}

package cmd

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/svkucheryavski/mathion/cli/internal/compose"
	"github.com/svkucheryavski/mathion/cli/internal/config"
	"github.com/svkucheryavski/mathion/cli/internal/varlib"
)

// seedInstall writes the install-state marker (+ a .env) that the --purge guard
// requires before it will os.RemoveAll a config dir.
func seedInstall(t *testing.T, dir string) {
	t.Helper()
	if err := config.WriteState(dir, config.State{Schema: 1, AdminEmail: "you@example.edu"}); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, ".env"), []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestUninstallPlainIsComposeDown(t *testing.T) {
	rootedVarlib(t)
	f := &compose.FakeRunner{}
	cmd := newUninstallCmd(newTestApp(f))
	if err := cmd.Execute(); err != nil {
		t.Fatal(err)
	}
	// The preamble sweep is call 0; find the `down` and assert its exact argv.
	want := []string{"compose", "-p", "mathion_prod", "-f", "/etc/mathion/docker-compose.yml", "--env-file", "/etc/mathion/.env", "down"}
	if i := idxOfCall(f.Calls, func(a []string) bool { return reflect.DeepEqual(a, want) }); i < 0 {
		t.Fatalf("plain uninstall must issue `... down`, got %v", f.Calls)
	}
}

func TestPurgeRequiresTypedProjectName(t *testing.T) {
	rootedVarlib(t)
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, ".env"), []byte("x"), 0o600)
	f := &compose.FakeRunner{OutputFunc: func(args []string) (string, error) { return "", nil }}
	app := &App{CfgDir: dir, Project: "mathion_prod", Runner: f, Out: os.Stdout, Err: os.Stderr, In: strings.NewReader("wrong\n")}
	cmd := newUninstallCmd(app)
	cmd.SetArgs([]string{"--purge"})
	if err := cmd.Execute(); err == nil {
		t.Fatal("purge must abort when the typed confirmation does not match the project name")
	}
	if _, e := os.Stat(filepath.Join(dir, ".env")); e != nil {
		t.Fatal("cfgdir removed despite failed confirmation")
	}
	// A mismatched confirmation aborts AFTER the preamble sweep but BEFORE any
	// teardown: no `down`/teardown ran, and the only runner call is the sweep's ps.
	if hasCall(f.Calls, joinHas("down")) {
		t.Fatalf("a mismatch must run no teardown; calls=%v", f.Calls)
	}
	if len(f.Calls) != 1 {
		t.Fatalf("a mismatch must run no teardown, only the preamble sweep; got %v", f.Calls)
	}
}

// TestUninstallPurgeClearsBreadcrumbAfterTeardown pins the breadcrumb lifecycle of
// uninstall: a leftover recovery breadcrumb is cleared ONLY on the --purge path AND
// ONLY after the typed confirmation AND a successful teardown. A mistyped
// confirmation, a teardown failure, or a non-purge uninstall all RETAIN it.
func TestUninstallPurgeClearsBreadcrumbAfterTeardown(t *testing.T) {
	t.Run("purge-clears", func(t *testing.T) {
		rootedVarlib(t)
		seedBreadcrumb(t)
		dir := t.TempDir()
		seedInstall(t, dir)
		f := &compose.FakeRunner{} // default: Purge succeeds cleanly
		var errb bytes.Buffer
		app := &App{CfgDir: dir, Project: "mathion_prod", Runner: f, Out: os.Stdout, Err: &errb, In: strings.NewReader("mathion_prod\n")}
		cmd := newUninstallCmd(app)
		cmd.SetArgs([]string{"--purge"})
		if err := cmd.Execute(); err != nil {
			t.Fatalf("purge must succeed: %v", err)
		}
		if _, present, _ := varlib.ReadJournal(); present {
			t.Fatal("a successful purge must clear the breadcrumb after teardown")
		}
		if !hasCall(f.Calls, joinHas("network ls")) {
			t.Fatalf("teardown (Purge) must run before the breadcrumb is cleared; calls=%v", f.Calls)
		}
		// The lock must be released after the command returns.
		rel, lerr := varlib.Lock()
		if lerr != nil {
			t.Fatalf("lock not released: %v", lerr)
		}
		_ = rel()
	})

	t.Run("mistyped-retains", func(t *testing.T) {
		rootedVarlib(t)
		seedBreadcrumb(t)
		dir := t.TempDir()
		f := &compose.FakeRunner{}
		app := &App{CfgDir: dir, Project: "mathion_prod", Runner: f, Out: os.Stdout, Err: os.Stderr, In: strings.NewReader("wrong\n")}
		cmd := newUninstallCmd(app)
		cmd.SetArgs([]string{"--purge"})
		if err := cmd.Execute(); err == nil {
			t.Fatal("a mistyped confirmation must abort")
		}
		if _, present, _ := varlib.ReadJournal(); !present {
			t.Fatal("a mistyped confirmation must RETAIN the breadcrumb (it aborts before Purge)")
		}
	})

	t.Run("teardown-fail-retains", func(t *testing.T) {
		rootedVarlib(t)
		seedBreadcrumb(t)
		dir := t.TempDir()
		seedInstall(t, dir)
		// ps (the preamble sweep) succeeds; every other Output errors => Purge fails.
		f := &compose.FakeRunner{OutputFunc: func(args []string) (string, error) {
			if len(args) > 0 && args[0] == "ps" {
				return "", nil
			}
			return "", &noSuch{}
		}}
		app := &App{CfgDir: dir, Project: "mathion_prod", Runner: f, Out: os.Stdout, Err: os.Stderr, In: strings.NewReader("mathion_prod\n")}
		cmd := newUninstallCmd(app)
		cmd.SetArgs([]string{"--purge"})
		if err := cmd.Execute(); err == nil {
			t.Fatal("a teardown failure must surface")
		}
		// Ordering proof: RemoveJournal runs AFTER Purge, so a Purge failure retains it.
		if _, present, _ := varlib.ReadJournal(); !present {
			t.Fatal("a teardown failure must RETAIN the breadcrumb")
		}
	})

	t.Run("plain-retains", func(t *testing.T) {
		rootedVarlib(t)
		seedBreadcrumb(t)
		f := &compose.FakeRunner{}
		cmd := newUninstallCmd(newTestApp(f))
		if err := cmd.Execute(); err != nil {
			t.Fatalf("plain uninstall must succeed: %v", err)
		}
		if _, present, _ := varlib.ReadJournal(); !present {
			t.Fatal("a non-purge uninstall must RETAIN the breadcrumb (it never clears it)")
		}
	})
}

func TestPurgeSuccessRemovesCfgDir(t *testing.T) {
	rootedVarlib(t)
	dir := t.TempDir()
	seedInstall(t, dir) // install-state marker + .env
	// Default fake: ps -> "", every `ls` -> "" (absent) => Purge succeeds cleanly.
	f := &compose.FakeRunner{}
	var out bytes.Buffer
	app := &App{CfgDir: dir, Project: "mathion_prod", Runner: f, Out: &out, Err: os.Stderr, In: strings.NewReader("mathion_prod\n")}
	cmd := newUninstallCmd(app)
	cmd.SetArgs([]string{"--purge"})
	if err := cmd.Execute(); err != nil {
		t.Fatal(err)
	}
	if _, e := os.Stat(dir); !os.IsNotExist(e) {
		t.Fatalf("cfgdir must be removed after a successful purge, stat err = %v", e)
	}
	if !strings.Contains(out.String(), "purged.") {
		t.Fatalf("expected confirmation output after purge, got %q", out.String())
	}
}

// TestPurgeConfirmationNamesRetainedBackups pins the pre-release polish: the
// destructive --purge confirmation must state that backups in /var/lib/mathion are
// KEPT (spec §251 — purge deliberately leaves the varlib backups dir in place), so an
// operator is not surprised to find backups surviving a "purge".
func TestPurgeConfirmationNamesRetainedBackups(t *testing.T) {
	rootedVarlib(t)
	dir := t.TempDir()
	seedInstall(t, dir)
	f := &compose.FakeRunner{}
	var out bytes.Buffer
	app := &App{CfgDir: dir, Project: "mathion_prod", Runner: f, Out: &out, Err: os.Stderr, In: strings.NewReader("mathion_prod\n")}
	cmd := newUninstallCmd(app)
	cmd.SetArgs([]string{"--purge"})
	if err := cmd.Execute(); err != nil {
		t.Fatal(err)
	}
	if want := "backups in " + varlib.BackupsDir() + " are kept"; !strings.Contains(out.String(), want) {
		t.Fatalf("purge confirmation must name the retained backups dir (%q); got %q", want, out.String())
	}
}

func TestPurgeRetainsCfgDirOnTeardownFailure(t *testing.T) {
	rootedVarlib(t)
	dir := t.TempDir()
	seedInstall(t, dir) // marker present, so the guard passes and we reach teardown
	// ps succeeds, but the existence check errors (daemon-down-like) => fail closed.
	f := &compose.FakeRunner{OutputFunc: func(args []string) (string, error) {
		if len(args) > 0 && args[0] == "ps" {
			return "", nil
		}
		return "", &noSuch{}
	}}
	app := &App{CfgDir: dir, Project: "mathion_prod", Runner: f, Out: os.Stdout, Err: os.Stderr, In: strings.NewReader("mathion_prod\n")}
	cmd := newUninstallCmd(app)
	cmd.SetArgs([]string{"--purge"})
	if err := cmd.Execute(); err == nil {
		t.Fatal("purge must fail when teardown fails")
	}
	if _, e := os.Stat(filepath.Join(dir, ".env")); e != nil {
		t.Fatal("cfgdir removed despite teardown failure")
	}
}

func TestPurgeTearsDownButKeepsUnrecognizedCfgDir(t *testing.T) {
	rootedVarlib(t)
	dir := t.TempDir()
	// .env present but NO install-state marker → not a dir mathion owns. The
	// identity teardown must STILL run (it needs no config), but os.RemoveAll must
	// not touch this dir — it is left in place with a note, and the command succeeds.
	os.WriteFile(filepath.Join(dir, ".env"), []byte("x"), 0o600)
	f := &compose.FakeRunner{} // default: ps/ls -> "" => teardown succeeds (absent = no-op)
	var errBuf bytes.Buffer
	app := &App{CfgDir: dir, Project: "mathion_prod", Runner: f, Out: os.Stdout, Err: &errBuf, In: strings.NewReader("mathion_prod\n")}
	cmd := newUninstallCmd(app)
	cmd.SetArgs([]string{"--purge"})
	if err := cmd.Execute(); err != nil {
		t.Fatalf("purge must complete (teardown runs) even when cfgdir is unrecognized, got %v", err)
	}
	if !hasCall(f.Calls, joinHas("network ls")) {
		t.Fatalf("identity teardown (Purge) must run regardless of cfgdir recognition; calls=%v", f.Calls)
	}
	if _, e := os.Stat(filepath.Join(dir, ".env")); e != nil {
		t.Fatal("an unrecognized cfgdir must be left in place, not removed")
	}
	if !strings.Contains(errBuf.String(), "config dir left in place") {
		t.Fatalf("expected a note that the cfgdir was left in place, got %q", errBuf.String())
	}
}

func TestPurgeTearsDownButKeepsSymlinkCfgDir(t *testing.T) {
	rootedVarlib(t)
	base := t.TempDir()
	target := filepath.Join(base, "target")
	if err := os.Mkdir(target, 0o700); err != nil {
		t.Fatal(err)
	}
	seedInstall(t, target) // a VALID marker lives inside the symlink target
	link := filepath.Join(base, "link")
	if err := os.Symlink(target, link); err != nil {
		t.Fatal(err)
	}
	f := &compose.FakeRunner{}
	var errBuf bytes.Buffer
	// Trailing slash: Lstat(Clean(link+"/")) sees the LINK, so the removal guard
	// skips it. Teardown still runs; the symlink and its target are left untouched.
	app := &App{CfgDir: link + "/", Project: "mathion_prod", Runner: f, Out: os.Stdout, Err: &errBuf, In: strings.NewReader("mathion_prod\n")}
	cmd := newUninstallCmd(app)
	cmd.SetArgs([]string{"--purge"})
	if err := cmd.Execute(); err != nil {
		t.Fatalf("purge must complete (teardown runs) with a symlink cfgdir, got %v", err)
	}
	if !hasCall(f.Calls, joinHas("network ls")) {
		t.Fatalf("identity teardown (Purge) must run even when cfgdir is a symlink; calls=%v", f.Calls)
	}
	if _, e := os.Stat(filepath.Join(target, "install-state")); e != nil {
		t.Fatal("symlink target removed despite the removal guard")
	}
	if !strings.Contains(errBuf.String(), "config dir left in place") {
		t.Fatalf("expected a note that the cfgdir was left in place, got %q", errBuf.String())
	}
}

func TestPurgeRemovesOnlyMathionFilesFromPopulatedCfgDir(t *testing.T) {
	// `install` plants a valid install-state marker wherever MATHION_CONFIG_DIR
	// points, so recognizedCfgDir accepts even a populated/sensitive dir ($HOME,
	// /etc, ...). --purge must then remove ONLY mathion's own files and leave the
	// rest — os.RemoveAll would have recursively wiped the whole directory.
	rootedVarlib(t)
	dir := t.TempDir()
	seedInstall(t, dir) // install-state + .env (mathion's)
	userFile := filepath.Join(dir, "important.txt")
	if err := os.WriteFile(userFile, []byte("do not delete"), 0o644); err != nil {
		t.Fatal(err)
	}
	// A user file whose name resembles a temp file: the cleanup must match only
	// mathion's distinctive ".mathion-tmp-" prefix, never a generic ".tmp-…".
	tmpLike := filepath.Join(dir, ".tmp-notes")
	if err := os.WriteFile(tmpLike, []byte("keep me"), 0o644); err != nil {
		t.Fatal(err)
	}
	f := &compose.FakeRunner{}
	var errBuf bytes.Buffer
	app := &App{CfgDir: dir, Project: "mathion_prod", Runner: f, Out: os.Stdout, Err: &errBuf, In: strings.NewReader("mathion_prod\n")}
	cmd := newUninstallCmd(app)
	cmd.SetArgs([]string{"--purge"})
	if err := cmd.Execute(); err != nil {
		t.Fatalf("purge must succeed, got %v", err)
	}
	// mathion's files are gone (secrets removed)
	for _, name := range []string{".env", "install-state"} {
		if _, e := os.Stat(filepath.Join(dir, name)); !os.IsNotExist(e) {
			t.Fatalf("%s must be removed, stat err = %v", name, e)
		}
	}
	// the user's file AND the directory itself survive — never RemoveAll'd
	if b, e := os.ReadFile(userFile); e != nil || string(b) != "do not delete" {
		t.Fatalf("a non-mathion file in the config dir must be left intact (b=%q err=%v)", b, e)
	}
	// a user's ".tmp-…" file must NOT be caught by the temp cleanup
	if b, e := os.ReadFile(tmpLike); e != nil || string(b) != "keep me" {
		t.Fatalf("a user's .tmp-* file must survive (b=%q err=%v)", b, e)
	}
	if !strings.Contains(errBuf.String(), "left") {
		t.Fatalf("expected a note that the populated dir was left in place, got %q", errBuf.String())
	}
}

func TestRemoveCfgArtifactsRejectsEscapingSymlink(t *testing.T) {
	// Simulate the TOCTOU swap: after recognizedCfgDir validated it, cfgdir has
	// become a symlink pointing OUTSIDE its parent (at a victim dir / /etc). The
	// os.Root-based removal must reject it ("path escapes from parent") and delete
	// nothing in the target — where path-based os.Remove would have followed it.
	cfgParent := t.TempDir()
	victim := t.TempDir() // outside cfgParent
	victimEnv := filepath.Join(victim, ".env")
	if err := os.WriteFile(victimEnv, []byte("VICTIM SECRET"), 0o600); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(cfgParent, "cfg")
	if err := os.Symlink(victim, link); err != nil {
		t.Fatal(err)
	}
	if err := removeCfgArtifacts(link); err == nil {
		t.Fatal("removeCfgArtifacts must reject a cfgdir that is an escaping symlink")
	}
	if _, e := os.Stat(victimEnv); e != nil {
		t.Fatalf("victim .env deleted through an escaping symlink — TOCTOU not closed (%v)", e)
	}
}

func TestRemoveCfgArtifactsRejectsInParentSymlink(t *testing.T) {
	// The subtler leaf race: after recognizedCfgDir validated it, cfgdir is
	// swapped for a RELATIVE symlink to a SIBLING inside the same parent. That
	// stays within the parent root, so parent.OpenRoot FOLLOWS it (an escaping
	// symlink would be rejected, but this one is not). The marker re-check on the
	// opened handle must then see the sibling has no valid install-state, return
	// errCfgUnrecognized, and delete nothing — otherwise the sibling's own .env,
	// docker-compose.yml and install-state would be removed.
	parent := t.TempDir()
	victim := filepath.Join(parent, "victim") // sibling, no valid marker
	if err := os.Mkdir(victim, 0o700); err != nil {
		t.Fatal(err)
	}
	victimEnv := filepath.Join(victim, ".env")
	if err := os.WriteFile(victimEnv, []byte("VICTIM SECRET"), 0o600); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(parent, "cfg")
	if err := os.Symlink("victim", link); err != nil { // RELATIVE → stays in-root
		t.Fatal(err)
	}
	err := removeCfgArtifacts(link)
	if !errors.Is(err, errCfgUnrecognized) {
		t.Fatalf("in-parent symlink to a markerless dir must be refused as unrecognized, got %v", err)
	}
	if _, e := os.Stat(victimEnv); e != nil {
		t.Fatalf("victim .env deleted through an in-parent symlink — leaf TOCTOU not closed (%v)", e)
	}
}

func TestPurgeOrphanStateStillTearsDown(t *testing.T) {
	// Orphan/recovery state: the config dir does not exist at all (.env + config
	// gone) but docker resources may survive. --purge is the config-independent
	// recovery hatch — teardown must run and the command must succeed (so a partial
	// purge can be re-run to finish), not abort on the missing dir.
	rootedVarlib(t)
	dir := filepath.Join(t.TempDir(), "gone") // never created
	f := &compose.FakeRunner{}
	var errBuf bytes.Buffer
	app := &App{CfgDir: dir, Project: "mathion_prod", Runner: f, Out: os.Stdout, Err: &errBuf, In: strings.NewReader("mathion_prod\n")}
	cmd := newUninstallCmd(app)
	cmd.SetArgs([]string{"--purge"})
	if err := cmd.Execute(); err != nil {
		t.Fatalf("purge in the orphan state (no config) must still tear down, got %v", err)
	}
	if !hasCall(f.Calls, joinHas("network ls")) {
		t.Fatalf("identity teardown (Purge) must run in the orphan state; calls=%v", f.Calls)
	}
	if !strings.Contains(errBuf.String(), "config dir left in place") {
		t.Fatalf("expected a note about the missing config dir, got %q", errBuf.String())
	}
}

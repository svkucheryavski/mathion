package cmd

import (
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"strings"
	"testing"

	"github.com/svkucheryavski/mathion/cli/internal/compose"
	"github.com/svkucheryavski/mathion/cli/internal/config"
	"github.com/svkucheryavski/mathion/cli/internal/prompt"
)

func TestResumePullsProxyImagesWhenTLSEnabled(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(dir+"/.env", []byte(config.RenderEnv(config.GenerateEnv("https://learn.example.edu", "v0.1.1", "s", "abc123hex"))), 0o600)
	if err := config.SetTLS(dir, "learn.example.edu", "admin@example.edu"); err != nil {
		t.Fatal(err)
	}
	var calls [][]string
	fr := &compose.FakeRunner{
		RunFunc:    func(a []string) error { calls = append(calls, a); return nil },
		OutputFunc: func(a []string) (string, error) { return "present\n", nil }, // pgdata present => skip app pull
	}
	app := &App{CfgDir: dir, Project: "mathion_prod", Runner: fr, Out: os.Stderr, Err: os.Stderr, tlsEnabled: true}
	// resume runs migrate+superuser via compose exec; the FakeRunner returns nil for those.
	_ = app.resume(context.Background(), config.State{Schema: 1, AdminEmail: "admin@example.edu"})
	var pulled bool
	for _, c := range calls {
		if strings.Contains(strings.Join(c, " "), "pull --policy missing proxy proxy-init") {
			pulled = true
		}
	}
	if !pulled {
		t.Fatalf("a TLS-enabled resume must targeted-pull the proxy images before --pull never up; calls=%v", calls)
	}
}

func freshApp(t *testing.T, answers string, interactive bool) (*App, *bytes.Buffer) {
	t.Helper()
	var out bytes.Buffer
	return &App{CfgDir: t.TempDir(), Project: "mathion_prod", Runner: &compose.FakeRunner{}, Out: &out, Err: &out,
		Prompt: prompt.New(strings.NewReader(answers), &out, interactive)}, &out
}

func TestInstallAsksForMissingValues(t *testing.T) {
	flag, _ := freshApp(t, "", false)
	if err := flag.runInstall(context.Background(), installOpts{Domain: "Learn.Example.EDU.", AdminEmail: "you@example.edu"}); err != nil {
		t.Fatal(err)
	}
	asked, out := freshApp(t, "http://x\nLearn.Example.EDU.\nnot-an-email\nyou@example.edu\nn\n", true)
	if err := asked.runInstall(context.Background(), installOpts{}); err != nil {
		t.Fatal(err)
	}
	want, _ := config.ReadEnvFile(flag.CfgDir)
	got, _ := config.ReadEnvFile(asked.CfgDir)
	if got["MATHION_BASE_URL"] == "" || got["MATHION_BASE_URL"] != want["MATHION_BASE_URL"] {
		t.Fatalf("asked %q, flag %q", got["MATHION_BASE_URL"], want["MATHION_BASE_URL"])
	}
	st, _ := config.ReadState(asked.CfgDir)
	if st.AdminEmail != "you@example.edu" {
		t.Fatalf("admin %q", st.AdminEmail)
	}
	for _, s := range []string{"Site address (e.g. learn.school.edu): ", "Your email (you become the site administrator): ", "invalid email address"} {
		if !strings.Contains(out.String(), s) {
			t.Fatalf("output lacks %q: %q", s, out.String())
		}
	}
	if strings.Contains(out.String(), "--domain must") || !strings.Contains(out.String(), "  Type only the address, without http://") {
		t.Fatalf("a typed answer's error must not name the flag: %q", out.String())
	}
}

func TestInstallFlagsSkipQuestions(t *testing.T) {
	app, out := freshApp(t, "", true)
	app.Prompt = prompt.New(failReader{t}, out, true)
	if err := app.runInstall(context.Background(), installOpts{Domain: "learn.example.edu", AdminEmail: "you@example.edu", NoTLS: true}); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(out.String(), "Site address") {
		t.Fatalf("asked despite flags: %q", out.String())
	}
}

func TestInstallAsksOnlyForTheMissingValue(t *testing.T) {
	app, out := freshApp(t, "you@example.edu\nn\n", true)
	if err := app.runInstall(context.Background(), installOpts{Domain: "learn.example.edu"}); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(out.String(), "Site address") || !strings.Contains(out.String(), "Your email") {
		t.Fatalf("output %q", out.String())
	}
}

func TestInstallNonInteractiveMissingValueErrors(t *testing.T) {
	app, _ := freshApp(t, "", false)
	err := app.runInstall(context.Background(), installOpts{Domain: "learn.example.edu"})
	if err == nil || !strings.Contains(err.Error(), "install requires --domain and --admin-email (or run it in a terminal to be asked)") {
		t.Fatalf("err = %v", err)
	}
}

func TestInstallYesNeverAsks(t *testing.T) {
	app, out := freshApp(t, "", true)
	app.Prompt = prompt.New(failReader{t}, out, true)
	err := app.runInstall(context.Background(), installOpts{Domain: "learn.example.edu", Yes: true})
	if err == nil || !strings.Contains(err.Error(), "requires --domain and --admin-email") {
		t.Fatalf("err = %v", err)
	}
	if _, e := os.Stat(app.CfgDir + "/.env"); e == nil {
		t.Fatal(".env written despite a missing value")
	}
}

func TestInstallInputEndsStops(t *testing.T) {
	app, _ := freshApp(t, "", true)
	err := app.runInstall(context.Background(), installOpts{})
	if err == nil || !strings.Contains(err.Error(), "--domain") {
		t.Fatalf("err = %v", err)
	}
	if _, e := os.Stat(app.CfgDir + "/.env"); e == nil {
		t.Fatal(".env written after the input ended")
	}
}

func TestInstallSiteAddressWording(t *testing.T) {
	for in, want := range map[string]string{
		"https://learn.school.edu": "Type only the address, without http:// or https://",
		"learn.school.edu/path":    "Type only the address, without a path",
		"":                         "Please type the site address",
	} {
		err := checkSiteAddress(in)
		if err == nil || !strings.Contains(err.Error(), want) || strings.Contains(err.Error(), "authority") {
			t.Fatalf("%q: %v", in, err)
		}
	}
}

func TestInstallInputEndsAtAddressQuestion(t *testing.T) {
	app, _ := freshApp(t, "", true)
	err := app.runInstall(context.Background(), installOpts{})
	if err == nil || !strings.Contains(err.Error(), "The question was not answered. Run sudo mathion install again, or pass --domain and --admin-email.") {
		t.Fatalf("err = %v", err)
	}
}

func TestInstallSiteAddressTrailingSlashLikeFlag(t *testing.T) {
	if _, err := config.BuildBaseURL("learn.school.edu/"); err != nil {
		t.Skip("the flag refuses it too")
	}
	if err := checkSiteAddress("learn.school.edu/"); err != nil {
		t.Fatalf("the flag accepts a trailing slash, the question must too: %v", err)
	}
}

func TestInstallSavesANormalisedAddress(t *testing.T) {
	app, _ := freshApp(t, "", false)
	if err := app.runInstall(context.Background(), installOpts{Domain: "Learn.Example.EDU.", AdminEmail: "you@example.edu"}); err != nil {
		t.Fatal(err)
	}
	m, _ := config.ReadEnvFile(app.CfgDir)
	if m["MATHION_BASE_URL"] != "https://learn.example.edu" {
		t.Fatalf("base URL %q", m["MATHION_BASE_URL"])
	}
}

func TestCheckSiteAddressNeedsADomain(t *testing.T) {
	for _, s := range []string{".", "learn.school.edu:"} {
		if err := checkSiteAddress(s); err == nil {
			t.Fatalf("%q must be refused", s)
		}
	}
	if err := checkSiteAddress("203.0.113.5"); err == nil || !strings.Contains(err.Error(), "Only if you run your own HTTPS proxy in front") || strings.Contains(err.Error(), "without HTTPS") {
		t.Fatalf("hint: %v", err)
	}
	for _, s := range []string{"203.0.113.5", "school", "my_school.edu", "localhost"} {
		if err := checkSiteAddress(s); err == nil || !strings.Contains(err.Error(), "needs a domain name such as learn.school.edu") {
			t.Fatalf("%q: err=%v", s, err)
		}
	}
	for _, s := range []string{"learn.school.edu", "Learn.School.EDU.", "203.0.113.5:8000", "localhost:8000"} {
		if err := checkSiteAddress(s); err != nil {
			t.Fatalf("%q: %v", s, err)
		}
	}
}

func TestInstallAsksAgainForANonDomain(t *testing.T) {
	app, out := freshApp(t, "203.0.113.5\nlearn.example.edu\nyou@example.edu\nn\n", true)
	if err := app.runInstall(context.Background(), installOpts{}); err != nil {
		t.Fatal(err)
	}
	env, _ := config.ReadEnvFile(app.CfgDir)
	if env["MATHION_BASE_URL"] != "https://learn.example.edu" || !strings.Contains(out.String(), "an IP address or a short name cannot get a free certificate") {
		t.Fatalf("base %q out %q", env["MATHION_BASE_URL"], out.String())
	}
}

func TestInstallRejectsADotDomain(t *testing.T) {
	app, _ := freshApp(t, "", false)
	if err := app.checkFlagsEarly(installOpts{Domain: ".", AdminEmail: "you@example.edu"}); err == nil {
		t.Fatal("want an error for --domain .")
	}
	if err := app.checkFlagsEarly(installOpts{Domain: "school", AdminEmail: "you@example.edu"}); err != nil {
		t.Fatalf("the flag keeps its rules: %v", err)
	}
}

func TestFreshInstallStartFailureSaysRunAgain(t *testing.T) {
	for step, words := range map[string]string{
		"pull":             "while downloading Mathion",
		"up -d --wait":     "while starting its containers",
		"alembic":          "while preparing the database",
		"create-superuser": "while creating your account",
	} {
		f := &compose.FakeRunner{RunFunc: func(args []string) error {
			if strings.Contains(strings.Join(args, " "), step) {
				return errors.New("exit status 1")
			}
			return nil
		}}
		app := &App{CfgDir: t.TempDir(), Project: "mathion_prod", Runner: f, Out: io.Discard, Err: io.Discard}
		err := app.runInstallFresh(context.Background(), installOpts{Domain: "learn.example.edu", AdminEmail: "you@example.edu", NoTLS: true})
		if err == nil || !strings.Contains(err.Error(), words) || !strings.Contains(err.Error(), "run sudo mathion install again; it continues where it stopped") {
			t.Fatalf("%s: err=%v", step, err)
		}
	}
}

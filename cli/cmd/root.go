package cmd

import (
	"context"
	"io"
	"os"
	"strings"

	"github.com/spf13/cobra"
	"github.com/svkucheryavski/mathion/cli/internal/compose"
	"github.com/svkucheryavski/mathion/cli/internal/config"
)

type App struct {
	CfgDir     string
	Project    string
	Runner     compose.Runner
	Out        io.Writer
	Err        io.Writer
	In         io.Reader
	tlsEnabled bool // read fail-safe at startup; toggled by tls enable/disable
}

// buildVersion / buildDefaultImage are overridden by main via SetBuildInfo,
// which in turn receives goreleaser ldflags at release time.
var buildVersion, buildDefaultImage = "dev", "v0.1.1"

// osExit is the process-exit seam Execute's error mapping and the update signal
// handler's second-signal hard-exit call; a var so tests can drive them without
// terminating the test process.
var osExit = os.Exit

func SetBuildInfo(v, img string) { buildVersion, buildDefaultImage = v, img }

func (a *App) composeArgs(sub ...string) []string {
	base := []string{
		"compose", "-p", a.Project,
		"-f", a.CfgDir + "/docker-compose.yml",
		"--env-file", a.CfgDir + "/.env",
	}
	if a.tlsProfileWanted(sub) {
		base = append(base, "--profile", "tls")
	}
	return append(base, sub...)
}

// tlsProfileWanted decides whether `--profile tls` is added, keyed on the subcommand
// sub[0] — the three-way split (spec §4.3):
//   - containment / inspection (down/stop/rm/ps/logs): ALWAYS, so `mathion stop`/
//     `uninstall`/`tls disable` reach a running proxy; harmless no-op when the on-disk
//     compose declares no tls profile (verified: rc=0 on Compose v5.1.2).
//   - start (up/start/create/run): ONLY when TLS is enabled, so the proxy is never
//     started on a non-TLS deployment.
//   - everything else (pull/exec/config/…) and an empty sub: NEVER — install's
//     whole-project `compose pull` must not fetch the proxy images (would fail in
//     air-gapped registries); TLS resume/restore pull the proxy images explicitly.
func (a *App) tlsProfileWanted(sub []string) bool {
	if len(sub) == 0 {
		return false
	}
	switch sub[0] {
	case "down", "stop", "rm", "ps", "logs":
		return true
	case "up", "start", "create", "run":
		return a.tlsEnabled
	default:
		return false
	}
}

// tlsEnabledFromEnv reads MATHION_TLS_DOMAIN fail-safe: a missing/corrupt/absent .env
// (any command before install) reads as disabled, never a hard error.
func tlsEnabledFromEnv(cfgDir string) bool {
	m, err := config.ReadEnvFile(cfgDir)
	if err != nil {
		return false
	}
	return strings.TrimSpace(m["MATHION_TLS_DOMAIN"]) != ""
}

func (a *App) compose(ctx context.Context, sub ...string) error {
	return a.Runner.Run(ctx, a.composeArgs(sub...)...)
}

func resolveCfgDir() string {
	if v := os.Getenv("MATHION_CONFIG_DIR"); v != "" {
		return v
	}
	return "/etc/mathion"
}

func resolveProject() string {
	if v := os.Getenv("MATHION_PROJECT_OVERRIDE"); v != "" {
		return v
	}
	return "mathion_prod"
}

func newRootCmd(app *App) *cobra.Command {
	root := &cobra.Command{
		Use:           "mathion",
		Short:         "Self-host and manage a Mathion deployment",
		SilenceUsage:  true,
		SilenceErrors: true,
	}
	root.AddCommand(
		newInstallCmd(app), newStartCmd(app), newStopCmd(app), newStatusCmd(app),
		newLogsCmd(app), newPinCmd(app), newSuperuserCmd(app), newVersionCmd(app),
		newUninstallCmd(app), newBackupCmd(app), newRestoreCmd(app), newUpdateCmd(app),
		newSelfUpdateCmd(app), newTLSCmd(app),
	)
	return root
}

func Execute() {
	app := &App{
		CfgDir:  resolveCfgDir(),
		Project: resolveProject(),
		Runner:  compose.ExecRunner{},
		Out:     os.Stdout, Err: os.Stderr, In: os.Stdin,
	}
	app.tlsEnabled = tlsEnabledFromEnv(app.CfgDir)
	if err := newRootCmd(app).ExecuteContext(context.Background()); err != nil {
		app.Err.Write([]byte("error: " + err.Error() + "\n"))
		osExit(exitCode(err))
	}
}

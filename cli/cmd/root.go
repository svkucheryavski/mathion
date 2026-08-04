package cmd

import (
	"context"
	"io"
	"os"

	"github.com/spf13/cobra"
	"github.com/svkucheryavski/mathion/cli/internal/compose"
)

type App struct {
	CfgDir  string
	Project string
	Runner  compose.Runner
	Out     io.Writer
	Err     io.Writer
	In      io.Reader
}

// buildVersion / buildDefaultImage are overridden by main via SetBuildInfo,
// which in turn receives goreleaser ldflags at release time.
var buildVersion, buildDefaultImage = "dev", "v0.1.1"

func SetBuildInfo(v, img string) { buildVersion, buildDefaultImage = v, img }

func (a *App) composeArgs(sub ...string) []string {
	base := []string{
		"compose", "-p", a.Project,
		"-f", a.CfgDir + "/docker-compose.yml",
		"--env-file", a.CfgDir + "/.env",
	}
	return append(base, sub...)
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
		newUninstallCmd(app),
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
	if err := newRootCmd(app).ExecuteContext(context.Background()); err != nil {
		app.Err.Write([]byte("error: " + err.Error() + "\n"))
		os.Exit(1)
	}
}

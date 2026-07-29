package cmd

import (
	"context"
	"fmt"
	"os"

	"github.com/spf13/cobra"
	"github.com/svkucheryavski/mathion/cli/internal/compose"
	"github.com/svkucheryavski/mathion/cli/internal/config"
	"github.com/svkucheryavski/mathion/cli/internal/dockerx"
	"github.com/svkucheryavski/mathion/cli/internal/secrets"
)

type installOpts struct {
	Domain, AdminEmail, Version string
	Yes                         bool
}

func newInstallCmd(app *App) *cobra.Command {
	var o installOpts
	c := &cobra.Command{
		Use:   "install",
		Short: "Install and start a Mathion deployment",
		RunE: func(c *cobra.Command, _ []string) error {
			return app.runInstall(c.Context(), o) // dispatcher: Task 12
		},
	}
	c.Flags().StringVar(&o.Domain, "domain", "", "deployment domain (host[:port], no scheme)")
	c.Flags().StringVar(&o.AdminEmail, "admin-email", "", "first superuser email")
	c.Flags().StringVar(&o.Version, "version", "", "app image tag (default: recommended)")
	c.Flags().BoolVar(&o.Yes, "yes", false, "non-interactive: require --domain and --admin-email")
	return c
}

func (a *App) runInstall(ctx context.Context, o installOpts) error {
	envPath := a.CfgDir + "/.env"
	_, statErr := os.Stat(envPath)
	envExists := statErr == nil

	// Step 2 (partial): docker/daemon reachable — needed by both branches.
	if err := dockerx.Preflight(ctx, a.Runner); err != nil {
		return err
	}

	if envExists {
		// RESUME or FAIL CLOSED. .env must be a complete, valid config.
		if fi, err := os.Lstat(envPath); err != nil || !fi.Mode().IsRegular() {
			return fmt.Errorf(".env at %s is not a regular file; repair it or run `mathion uninstall --purge`", envPath)
		}
		st, err := config.ReadState(a.CfgDir)
		if err != nil {
			return fmt.Errorf("install-state is missing or invalid (%w); repair it or run `mathion uninstall --purge`", err)
		}
		if _, err := config.ReadEnvFile(a.CfgDir); err != nil {
			return fmt.Errorf(".env is unreadable (%w); repair it or run `mathion uninstall --purge`", err)
		}
		warnDivergentFlags(a, o, st) // domain/email/version are ignored on resume
		return a.resume(ctx, st)
	}

	// FRESH branch: volume guard BEFORE any secret is generated.
	for _, vol := range []string{a.Project + "_mathion_pgdata", a.Project + "_mathion_assets"} {
		exists, err := dockerx.VolumeExists(ctx, a.Runner, vol)
		if err != nil {
			return err
		}
		if exists {
			return fmt.Errorf("volume %s already exists but %s/.env is gone — refusing to regenerate secrets over initialized data. Restore .env, or run `mathion uninstall --purge` for a clean slate", vol, a.CfgDir)
		}
	}
	// Port preflight is fresh-only (on resume our own app legitimately holds it).
	if err := dockerx.PortFree("127.0.0.1:8000"); err != nil {
		return err
	}
	if o.Yes && (o.Domain == "" || o.AdminEmail == "") {
		return fmt.Errorf("--yes requires both --domain and --admin-email")
	}
	// (interactive prompt for any missing value when not --yes) — promptIfEmpty
	return a.runInstallFresh(ctx, o)
}

func warnDivergentFlags(a *App, o installOpts, st config.State) {
	if o.AdminEmail != "" && config.NormalizeEmail(o.AdminEmail) != st.AdminEmail {
		fmt.Fprintf(a.Err, "warning: --admin-email differs from the installed admin (%s); ignored on resume (use `mathion superuser`)\n", st.AdminEmail)
	}
	if o.Domain != "" || o.Version != "" {
		fmt.Fprintln(a.Err, "warning: --domain/--version are ignored on resume (Slice 3's `update` handles version bumps)")
	}
}

// resume re-materializes compose from the embed and re-runs idempotent steps.
func (a *App) resume(ctx context.Context, st config.State) error {
	if err := config.EnsureConfigDir(a.CfgDir); err != nil {
		return err
	}
	if err := config.AtomicWrite(a.CfgDir+"/docker-compose.yml", composeBytes(), 0o644); err != nil {
		return err
	}
	if err := a.compose(ctx, "pull"); err != nil {
		return err
	}
	if err := a.compose(ctx, "up", "-d", "--wait"); err != nil {
		return err
	}
	if err := a.compose(ctx, "exec", "-T", "app", "alembic", "upgrade", "head"); err != nil {
		return err
	}
	return a.compose(ctx, "exec", "-T", "app", "python", "-m", "mathion.superuser", "create-superuser", st.AdminEmail)
}

func (a *App) runInstallFresh(ctx context.Context, o installOpts) error {
	// 3. Gather + validate inputs.
	if o.Version == "" {
		o.Version = buildDefaultImage
	}
	if err := config.ValidateOCITag(o.Version); err != nil {
		return err
	}
	if err := config.ValidateEmail(o.AdminEmail); err != nil {
		return err
	}
	email := config.NormalizeEmail(o.AdminEmail)
	baseURL, err := config.BuildBaseURL(o.Domain)
	if err != nil {
		return err
	}

	// 4. Write config: compose + state BEFORE .env; .env LAST.
	if err := config.EnsureConfigDir(a.CfgDir); err != nil {
		return err
	}
	if err := config.AtomicWrite(a.CfgDir+"/docker-compose.yml", composeBytes(), 0o644); err != nil {
		return err
	}
	if err := config.WriteState(a.CfgDir, config.State{Schema: 1, AdminEmail: email}); err != nil {
		return err
	}
	secret, err := secrets.SecretKey()
	if err != nil {
		return err
	}
	pw, err := secrets.PGPassword()
	if err != nil {
		return err
	}
	env := config.GenerateEnv(baseURL, o.Version, secret, pw)
	if err := config.AtomicWrite(a.CfgDir+"/.env", []byte(config.RenderEnv(env)), 0o600); err != nil {
		return err
	}

	// 5-7. Pull, up, migrate, create superuser.
	if err := a.compose(ctx, "pull"); err != nil {
		return err
	}
	if err := a.compose(ctx, "up", "-d", "--wait"); err != nil {
		return err
	}
	if err := a.compose(ctx, "exec", "-T", "app", "alembic", "upgrade", "head"); err != nil {
		return err
	}
	if err := a.compose(ctx, "exec", "-T", "app", "python", "-m", "mathion.superuser", "create-superuser", email); err != nil {
		return err
	}

	// 8. Next steps (no secrets printed).
	fmt.Fprintf(a.Out, nextSteps, o.Domain, email)
	return nil
}

func composeBytes() []byte { return compose.ComposeYAML }

const nextSteps = `
Deployment up. Next:
  1. Put a TLS-terminating reverse proxy in front (see README "Self-hosting").
  2. Log in at https://%s — NOT http://127.0.0.1:8000 (the Secure session cookie
     won't persist over plain HTTP).
  3. Issue your first-login PIN:  sudo mathion pin %s
  4. (optional) superuser panel URL: docker compose ... exec -T app python -m mathion.superuser activate
`

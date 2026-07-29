package cmd

import (
	"context"
	"fmt"

	"github.com/spf13/cobra"
	"github.com/svkucheryavski/mathion/cli/internal/compose"
	"github.com/svkucheryavski/mathion/cli/internal/config"
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

// runInstall is a temporary passthrough to the fresh path; the real
// fresh-vs-resume-vs-abort dispatcher replaces it in Task 12.
func (a *App) runInstall(ctx context.Context, o installOpts) error { return a.runInstallFresh(ctx, o) }

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

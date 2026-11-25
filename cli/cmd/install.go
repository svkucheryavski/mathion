package cmd

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"

	"github.com/spf13/cobra"
	"github.com/svkucheryavski/mathion/cli/internal/compose"
	"github.com/svkucheryavski/mathion/cli/internal/config"
	"github.com/svkucheryavski/mathion/cli/internal/dockerx"
	"github.com/svkucheryavski/mathion/cli/internal/secrets"
)

type installOpts struct {
	Domain, AdminEmail, Version string
	Yes, NoTLS                  bool
}

func newInstallCmd(app *App) *cobra.Command {
	var o installOpts
	c := &cobra.Command{
		Use:   "install",
		Short: "Install and start a Mathion deployment",
		RunE: func(c *cobra.Command, _ []string) error {
			// Docker first: lockAndGuard sweeps containers with it.
			if err := requireRoot(); err != nil {
				return err
			}
			if err := app.checkFlagsEarly(o); err != nil {
				return err
			}
			if err := app.ensureDocker(c.Context(), o.Yes); err != nil {
				return err
			}
			release, proceed, err := lockAndGuard(c.Context(), app, "install")
			defer release()
			if err != nil || !proceed {
				return err
			}
			return app.runInstall(c.Context(), o) // dispatcher: Task 12
		},
	}
	c.Flags().StringVar(&o.Domain, "domain", "", "deployment domain (host[:port], no scheme)")
	c.Flags().StringVar(&o.AdminEmail, "admin-email", "", "first superuser email")
	c.Flags().StringVar(&o.Version, "version", "", "app image tag (default: recommended)")
	c.Flags().BoolVar(&o.Yes, "yes", false, "scripted install: never ask; needs --domain and --admin-email, and installs Docker if it is missing")
	c.Flags().BoolVar(&o.NoTLS, "no-tls", false, "do not set up the bundled HTTPS proxy")
	return c
}

func (a *App) runInstall(ctx context.Context, o installOpts) error {
	envPath := a.CfgDir + "/.env"
	// Lstat (not Stat): Stat follows symlinks, so a DANGLING .env symlink returns
	// ENOENT and would be misread as "absent" → the fresh path, which regenerates
	// secrets. Lstat inspects the entry itself: a genuinely missing entry is the
	// only "absent" (→ fresh); a dangling/non-regular symlink is present-but-broken
	// (→ fail-closed regular-file guard below); any other fs error fails closed.
	fi, statErr := os.Lstat(envPath)
	if statErr != nil && !os.IsNotExist(statErr) {
		return fmt.Errorf("cannot access %s: %w", envPath, statErr)
	}
	envExists := statErr == nil

	// Step 2 (partial): docker/daemon reachable — needed by both branches.
	if err := dockerx.Preflight(ctx, a.Runner); err != nil {
		return err
	}

	if envExists {
		// RESUME or FAIL CLOSED. .env must be a complete, valid config. The Lstat
		// above already inspected the entry; a symlink/dir/anything non-regular is
		// rejected here (a dangling .env symlink lands here, not on the fresh path).
		if !fi.Mode().IsRegular() {
			return fmt.Errorf(".env at %s is not a regular file; repair it or run `mathion uninstall --purge`", envPath)
		}
		// .env holds secrets — a resume must refuse a file that has been made
		// group/world-accessible rather than reuse it.
		if perm := fi.Mode().Perm(); perm&0o077 != 0 {
			return fmt.Errorf(".env at %s is group/world-accessible (%v); it holds secrets — fix with `chmod 600 %s`", envPath, perm, envPath)
		}
		st, err := config.ReadState(a.CfgDir)
		if err != nil {
			return fmt.Errorf("install-state is missing or invalid (%w); repair it or run `mathion uninstall --purge`", err)
		}
		envMap, err := config.ReadEnvFile(a.CfgDir)
		if err != nil {
			return fmt.Errorf(".env is unreadable (%w); repair it or run `mathion uninstall --purge`", err)
		}
		// Fail closed on a corrupt/incomplete .env: resume trusts it verbatim, so
		// a missing key or decoupled DB password must abort, not boot a broken stack.
		if err := config.ValidateEnvComplete(envMap); err != nil {
			return fmt.Errorf(".env is incomplete or inconsistent (%w); repair it or run `mathion uninstall --purge`", err)
		}
		warnDivergentFlags(a, o, st) // domain/email/version are ignored on resume
		if err := a.resume(ctx, st); err != nil {
			return err
		}
		return a.rerunHTTPS(ctx, st.AdminEmail, o)
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
	// Ask for values not given as flags; --yes or no terminal never asks.
	if o.Domain == "" || o.AdminEmail == "" {
		if err := a.askMissing(&o); err != nil {
			return err
		}
	}
	return a.runInstallFresh(ctx, o)
}

// askMissing asks for the site address and admin email when their flags are empty.
func (a *App) askMissing(o *installOpts) error {
	p := a.prompter()
	if o.Yes || !p.Interactive {
		return errors.New("install requires --domain and --admin-email (or run it in a terminal to be asked)")
	}
	var err error
	if o.Domain == "" {
		if o.Domain, err = p.Ask("Site address (e.g. learn.school.edu)", checkSiteAddress); err != nil {
			return unanswered(err, "pass --domain and --admin-email")
		}
	}
	if o.AdminEmail == "" {
		if o.AdminEmail, err = p.Ask("Your email (you become the site administrator)", checkAdminEmail); err != nil {
			return unanswered(err, "pass --domain and --admin-email")
		}
	}
	return nil
}

// checkFlagsEarly fails a fresh install on bad or missing flag values before Docker is touched.
func (a *App) checkFlagsEarly(o installOpts) error {
	if _, err := os.Lstat(a.CfgDir + "/.env"); !os.IsNotExist(err) {
		return nil // not a fresh install; runInstall decides
	}
	if (o.Domain == "" || o.AdminEmail == "") && (o.Yes || !a.prompter().Interactive) {
		return errors.New("install requires --domain and --admin-email (or run it in a terminal to be asked)")
	}
	if o.Domain != "" {
		if _, err := config.BuildBaseURL(o.Domain); err != nil {
			return err
		}
	}
	if o.AdminEmail != "" {
		if err := config.ValidateEmail(o.AdminEmail); err != nil {
			return err
		}
	}
	if o.Version != "" {
		return config.ValidateOCITag(o.Version)
	}
	return nil
}

// checkSiteAddress uses the --domain rules, worded for a typed answer.
func checkSiteAddress(s string) error {
	switch {
	case s == "":
		return errors.New("Please type the site address, for example learn.school.edu.")
	case strings.Contains(s, "://"):
		return errors.New("Type only the address, without http:// or https://, for example learn.school.edu.")
	case strings.Contains(strings.TrimSuffix(s, "/"), "/"):
		return errors.New("Type only the address, without a path, for example learn.school.edu.")
	}
	if _, err := config.BuildBaseURL(s); err != nil {
		return errors.New(strings.Replace(err.Error(), "--domain", "the site address", 1))
	}
	return nil
}

func checkAdminEmail(s string) error {
	if s == "" {
		return errors.New("Please type an email address.")
	}
	return config.ValidateEmail(s)
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
	// Volume-gated pull: the pgdata volume already existing means the image was
	// obtained by the prior (crashed) attempt — skip the registry pull so a
	// moved/absent tag can't swap the image out from under initialized data.
	// Positively absent ⇒ the prior attempt died before `up`, so the pull is safe
	// and needed. A detection error fails CLOSED (treat as present → no pull):
	// unlike the fresh volume guard (which must abort before regenerating secrets),
	// resume reuses existing config, so it proceeds without the pull.
	pgdata := a.Project + "_mathion_pgdata"
	present, verr := dockerx.VolumeExists(ctx, a.Runner, pgdata)
	if verr != nil {
		present = true // fail closed
	}
	if !present {
		if err := a.compose(ctx, "pull"); err != nil {
			return err
		}
	}
	// TLS-enabled resume: the whole-project up below is --pull never and now includes
	// the profiled proxy/proxy-init, so on a new host / after a proxy digest bump / on
	// the pgdata-present fast-path (which skipped the app pull) the proxy image may be
	// absent. Bounded best-effort targeted pull first; the up stays authoritative.
	if a.tlsEnabled {
		pctx, pcancel := context.WithTimeout(ctx, tlsProxyPullTimeout)
		if err := a.compose(pctx, "pull", "--policy", "missing", "proxy", "proxy-init"); err != nil {
			fmt.Fprintf(a.Err, "note: could not pre-pull the bundled proxy images (%v); continuing with cached images\n", err)
		}
		pcancel()
	}
	if err := a.compose(ctx, "up", "-d", "--wait", "--pull", "never"); err != nil {
		return err
	}
	// Always run the idempotent migrate: a crash between `up` and migrate leaves the
	// schema un-upgraded, and `alembic upgrade head` is a no-op when already current.
	if err := a.compose(ctx, "exec", "-T", "app", "alembic", "upgrade", "head"); err != nil {
		return err
	}
	if err := a.compose(ctx, "exec", "-T", "app", "python", "-m", "mathion.superuser", "create-superuser", "--", st.AdminEmail); err != nil {
		return err
	}
	return config.WriteState(a.CfgDir, config.State{Schema: 2, AdminEmail: st.AdminEmail, Complete: true})
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
	o.Domain = config.NormalizeSiteAddress(o.Domain)
	baseURL, err := config.BuildBaseURL(o.Domain)
	if err != nil {
		return err
	}
	// The HTTPS questions and checks come before anything is written or started.
	plan, h, err := a.httpsDecide(ctx, o.Domain, email, o)
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
	if err := config.WriteState(a.CfgDir, config.State{Schema: 2, AdminEmail: email, Complete: false}); err != nil {
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
	fmt.Fprintln(a.Out, "\n  Starting Mathion …")
	if err := a.compose(ctx, "pull"); err != nil {
		return err
	}
	if err := a.compose(ctx, "up", "-d", "--wait"); err != nil {
		return err
	}
	if err := a.compose(ctx, "exec", "-T", "app", "alembic", "upgrade", "head"); err != nil {
		return err
	}
	if err := a.compose(ctx, "exec", "-T", "app", "python", "-m", "mathion.superuser", "create-superuser", "--", email); err != nil {
		return err
	}
	if err := config.WriteState(a.CfgDir, config.State{Schema: 2, AdminEmail: email, Complete: true}); err != nil {
		return err
	}

	fmt.Fprintln(a.Out, "  Starting Mathion … ok")

	// 8. HTTPS, then the first PIN or the next step.
	if plan != nil {
		if h, err = a.httpsApply(ctx, plan); err != nil {
			return err
		}
	}
	a.printEnding(ctx, o.Domain, email, h)
	return nil
}

func composeBytes() []byte { return compose.ComposeYAML }

# Easier Install Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A non-developer gets Mathion running over HTTPS on a fresh Ubuntu or Debian server with one command line and a few answered questions.

**Architecture:** `deploy/install.sh` installs `mathion` as today, then hands over to `mathion install` with the keyboard attached. `mathion install` gains questions, a Docker check-and-install step, an HTTPS step (shared with `tls enable`) and a new ending. A new `mathion panel` command prints the admin panel link. Two new internal packages hold the testable parts: `internal/prompt` (questions) and `internal/dockersetup` (OS detection, Docker's key, the apt steps).

**Tech Stack:** Go 1.24 (`cli/`, cobra, `ProtonMail/go-crypto` already in go.mod), POSIX sh (`deploy/install.sh`).

**Spec:** `docs/superpowers/specs/2026-11-25-easy-install-design.md` (approved, `b7900223`).

## Global Constraints

- No new Go modules or Python packages (owner rule). Terminal detection uses `os.Stdin.Stat()`, `os.ModeCharDevice` and `os.SameFile` against `os.DevNull`, not `golang.org/x/term`. Callers abort on any Prompter error and never re-ask on the same reader.
- Automatic Docker install only on `ID=ubuntu` with `VERSION_ID` 22.04 or 24.04 (or newer), and `ID=debian` with `VERSION_ID` 12 or 13 (or newer), on amd64 or arm64. Everything else gets instructions with the link `https://docs.docker.com/engine/install/`.
- Docker's source is `https://download.docker.com/linux/<ubuntu|debian>`. Packages: `docker-ce docker-ce-cli containerd.io docker-compose-plugin`. Key fingerprint `9DC858229FC7DD38854AE2D88D81803C0EBFCD88`, confirmed in Task 2 from two independent sources before it is committed.
- Nothing changes on the server without a yes, except under `--yes`. `--yes` never asks a question.
- One-line code comments (owner rule). Code and tests only under `cli/` and `deploy/`; docs under `README.md`, `docs/`.
- The certificate wait is 2 minutes; every other wait stays under 30 s, except waits for another program holding the apt lock (up to 2 minutes for `apt-get update` and 120 s for the install; Task 2 ruling, owner OK 2026-11-25).
- Never open the Mac to the network. Real-server checks are owner steps on the rented beta server.
- Tests run with `cd cli && go vet ./... && go test ./...`; shell tests with `sh deploy/<name>_test.sh`. Never run two test processes at once.

## Review Focus

1. **`--yes` with DNS not pointing here yet:** the install must not hang or ask. It turns HTTPS on with a warning, ends with the "HTTPS is on, certificate still on its way" ending, and exits 0. Pinned in Task 4.
2. **Re-running after an interrupted Docker install** (Ctrl-C during apt): the re-run must find Docker missing again and redo the steps without duplicating the apt source or key file. Both files are written whole, never appended. Pinned in Task 2.
3. **A domain typed with uppercase letters or a trailing dot at the question:** it must get the same rules and the same normalisation as the `--domain` flag (`BuildBaseURL`), not a looser path. Pinned in Task 3.
4. **A server with IPv4 and IPv6 where DNS has only the A record:** the DNS check must pass when any resolved address is one of the server's own addresses. Pinned in Task 4.
5. **PIN output in an unexpected format:** the ending must print the superuser command's raw output rather than fail or print an empty PIN. Pinned in Task 5.

---

### Task 1: Questions (`internal/prompt`)

**Files:**
- Create: `cli/internal/prompt/prompt.go`
- Test: `cli/internal/prompt/prompt_test.go`

**Interfaces:**
- Produces:
  - `type Prompter struct { In *bufio.Reader; Out io.Writer; Interactive bool }`
  - `func New(in io.Reader, out io.Writer, interactive bool) *Prompter`
  - `func (p *Prompter) Ask(label string, check func(string) error) (string, error)`: trims the answer, re-asks after printing `  <check error>` on a failed check, returns `ErrNotInteractive` when `!Interactive`. Input that ends before a newline returns an error wrapping `io.ErrUnexpectedEOF` (match with `errors.Is`), after printing a newline; a line over 4096 bytes returns `ErrTooLong`.
  - `func (p *Prompter) Confirm(question string, def bool) (bool, error)`: prints `question [Y/n] ` or `[y/N] `; empty means `def`, `y`/`yes`/`n`/`no` in any case are accepted, anything else prints `  Please answer y or n.` and re-asks; returns `ErrNotInteractive` when `!Interactive`; EOF and long lines as for `Ask`.
  - `var ErrNotInteractive = errors.New("no terminal to ask on")`, `var ErrTooLong = errors.New("the answer is too long")`
  - `func StdinIsTerminal(f *os.File) bool`: a character device other than the null device (as built, Task 1 ruling).

- [ ] **Step 1: Write the failing tests** `TestAskRetriesUntilValid` (input `"bad\ngood\n"`, a check rejecting `bad` → returns `good`, output contains the check's message once), `TestAskTrims`, `TestAskNotInteractive` (`errors.Is(err, ErrNotInteractive)`, nothing printed), `TestAskEOF`, `TestConfirmDefaults` (empty line with def true → true; with def false → false), `TestConfirmAnswers` (`Y`, `no`, then `maybe\ny` → re-asked once → true), `TestConfirmNotInteractive`.
- [ ] **Step 2: Run** `cd cli && go test ./internal/prompt/`. Expected: FAIL (package missing).
- [ ] **Step 3: Implement** `prompt.go` with the signatures above.
- [ ] **Step 4: Run** the same. Expected: PASS.
- [ ] **Step 5: Review loop, then commit** `feat(cli): a prompt package for install questions`.

### Task 2: Docker check and install (`internal/dockersetup`)

**Files:**
- Create: `cli/internal/dockersetup/osrelease.go`, `cli/internal/dockersetup/key.go`, `cli/internal/dockersetup/apt.go`
- Test: `cli/internal/dockersetup/osrelease_test.go`, `key_test.go`, `apt_test.go`, plus `testdata/docker.asc` (the real public key, fetched in Step 1)

**Interfaces:**
- Produces:
  - `type OS struct { ID, VersionID, Codename string }`; `func ParseOSRelease(r io.Reader) (OS, error)` (reads `ID`, `VERSION_ID`, `VERSION_CODENAME`, strips quotes).
  - `func Supported(o OS) bool`: ubuntu ≥ 22.04, debian ≥ 12, compared numerically on major[.minor]; the codename must match `^[a-z]+$` (as built, Task 2 ruling).
  - `const DockerKeyFingerprint = "9DC858229FC7DD38854AE2D88D81803C0EBFCD88"`
  - `func CheckKey(armored []byte, wantFPR string) ([]byte, error)`: exactly one armored block, exactly one entity whose primary key fingerprint (upper hex) equals `wantFPR`; returns that entity armored again, which is what gets written (as built, Task 2 ruling).
  - `type Cmd interface { Run(ctx context.Context, name string, args ...string) error; Output(ctx context.Context, name string, args ...string) (string, error) }` and `ExecCmd` (real; no stdin; env `DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=l LC_ALL=C`; `Run` streams to the terminal and wraps `ErrLocked` on apt lock messages; `Output` shows stderr).
  - `type Steps struct { Cmd; Fetch; ReadFile; WriteFile; Remove; Sleep func(time.Duration); Out io.Writer; Arch string }` and `func NewSteps(arch string, out io.Writer) Steps` (real seams).
  - `func (s Steps) Install(ctx context.Context, o OS) error`: refuses `!Supported(o)` and `Arch` other than `amd64`/`arm64`, then in order:
    1. fetch `https://download.docker.com/linux/<id>/gpg`, then `CheckKey`;
    2. fetch `.../dists/<codename>/InRelease`; a 404 → `ErrNoDockerRelease` before anything is written;
    3. write `/etc/apt/keyrings/docker.asc` (0644, whole file, the checked key);
    4. write `/etc/apt/sources.list.d/docker.list` (whole file) with `deb [arch=<arch> signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/<id> <codename> stable`;
    5. run `apt-get update`, retrying every 10 s for up to 2 minutes while `ErrLocked`; on failure put the old `docker.list` back, or remove it;
    6. run `apt-get -o DPkg::Lock::Timeout=120 install -s <4 packages>`, refusing with `ErrWouldRemove` on `Remv `/`Purg ` lines;
    7. run `apt-get -o DPkg::Lock::Timeout=120 -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold install -y --no-remove <4 packages>`;
    8. run `systemctl enable --now docker`.

    Each failure is wrapped as `fmt.Errorf("installing Docker: <step name>: %w", err)`.
  - `func EnableAtBoot(ctx context.Context, c Cmd) (changed bool, err error)`: `systemctl is-enabled docker`; only when it says `disabled`, run `systemctl enable docker` and return true (snap Docker, no systemd and masked are left alone).
  - `var ErrWouldRemove, ErrNoDockerRelease, ErrLocked, ErrNotFound`; `func Instructions(reason string) string` (the reason, then the manual text with the Docker guide link; names Compose v2 and removing `docker.io` first).

- [ ] **Step 1: Confirm the fingerprint from two independent sources**, then save the key as `testdata/docker.asc`:
  1. `curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --show-keys`;
  2. `curl -fsSL 'https://keyserver.ubuntu.com/pks/lookup?op=get&search=0x8D81803C0EBFCD88' | gpg --show-keys`.

  Both must print `9DC858229FC7DD38854AE2D88D81803C0EBFCD88`. Record both outputs' fingerprint line in the ledger. A mismatch stops the task: ask the owner.
- [ ] **Step 2: Write the failing tests:**
  - `TestParseOSRelease`: the Ubuntu 24.04 and Debian 12 file texts, quoted and unquoted.
  - `TestSupported`: true for ubuntu 22.04, 24.04 and 26.04, and debian 12 and 13; false for ubuntu 20.04, debian 11, fedora 41, and an empty OS.
  - `TestCheckKeyAcceptsDocker` (`testdata/docker.asc`), `TestCheckKeyRejectsOtherKey` (a key generated in the test), `TestCheckKeyRejectsGarbage`.
  - `TestInstallStepsInOrder`: a recording fake `Cmd` and `WriteFile`; asserts the exact calls, file paths, the sources line for debian/bookworm/amd64, and modes.
  - `TestInstallRefusesRemovals`: the simulate output contains `Remv containerd [1.6]` → `errors.Is(err, ErrWouldRemove)`, and no `install -y` call.
  - `TestInstallStopsAtFailedStep`: a failing `apt-get update` → the error names "apt-get update", and no later calls.
  - `TestInstallRerunWritesWholeFiles` (Review Focus 2): two runs → each file written with identical whole contents both times, no appends.
  - `TestEnableAtBoot`: already enabled → no call, false; disabled → enable call, true.
- [ ] **Step 3: Run** `cd cli && go test ./internal/dockersetup/`. Expected: FAIL (package missing).
- [ ] **Step 4: Implement** the three files.
- [ ] **Step 5: Run** the same. Expected: PASS.
- [ ] **Step 6: Review loop, then commit** `feat(cli): Docker setup from Docker's signed apt source on Ubuntu and Debian`.

### Task 3: Questions and Docker in `mathion install`

**Files:**
- Modify: `cli/cmd/install.go` (opts, flags, `RunE`, `runInstall`), `cli/cmd/root.go` (`App` gets `Prompt *prompt.Prompter` (writes to stderr), `DockerCmd dockersetup.Cmd`, `DockerDaemon func() string` (`"dockerd"`, `"snap"` or `""`), `ReadOSRelease func() (dockersetup.OS, error)`, `InstallDocker func(ctx, dockersetup.OS, arch string) error`, set in `Execute`; as built, Task 3 ruling)
- Test: `cli/cmd/install_test.go`, new `cli/cmd/install_docker_test.go`

**Interfaces:**
- Consumes: Task 1 `Prompter`, Task 2 `Supported`, `NewSteps`, `Steps.Install`, `EnableAtBoot`, `Instructions`, `ErrWouldRemove`, `ErrNoDockerRelease`. `Arch` comes from `dpkg --print-architecture` (an armhf userland on an arm64 kernel gets the instructions).
- Produces:
  - `installOpts` gains `NoTLS bool` (flag `--no-tls`, help "do not set up the bundled HTTPS proxy").
  - `func (a *App) ensureDocker(ctx context.Context, yes bool) error`:
    - when `docker version` and `docker compose version` both succeed (existing `dockerx.Preflight`), call `EnableAtBoot` and print `Docker will now start at boot.` if it changed something;
    - when Docker works but Compose is missing, return an error carrying `Instructions("Docker works, but Docker Compose v2 is missing.")`;
    - otherwise read the OS: unsupported, or `Install` returns `ErrNoDockerRelease` → error with `Instructions(<reason>)`; supported → `Confirm("Docker is not installed. Install it from Docker's official packages?", true)` (skipped under `yes`); no → error `"Docker is needed; install it and run sudo mathion install again"` plus `Instructions`; yes → `Steps.Install`, then `Preflight` again.
  - `func (a *App) askMissing(o *installOpts) error`: asks `Site address (e.g. learn.school.edu)` with check `config.BuildBaseURL`, and `Your email (you become the site administrator)` with check `config.ValidateEmail`, only for empty fields and only on the fresh path.
- `RunE` order: `requireRoot()` → `checkFlagsEarly` (fresh install: missing values under `--yes` or no terminal, and bad flag values, fail before Docker is touched) → `ensureDocker` → `lockAndGuard` → `runInstall`. `ensureDocker` must run before `lockAndGuard`, whose `SweepWorkers` calls Docker.
- Interactive = `prompt.StdinIsTerminal(os.Stdin)`; every yes/no question goes through `a.confirm(yes, …)`, which answers yes under `--yes` without asking; `askMissing` refuses under `--yes`. A daemon that does not answer stops with a start hint (`snap start docker` for the snap; `systemctl enable --now docker` / `dpkg --configure -a` otherwise); a half-installed `docker-ce` is installed again; Docker working without Compose is finished from Docker's packages only when `docker-ce` is fully installed, any other Docker gets the instructions. Non-interactive with a missing value keeps today's error text, with "(interactive prompting is planned but not yet available)" replaced by "(or run it in a terminal to be asked)".

- [ ] **Step 1: Write the failing tests:**
  - `TestInstallAsksForMissingValues`: scripted input `"Learn.Example.EDU.\nyou@example.edu\n"` → the fresh path receives the same domain `BuildBaseURL` gives for the flag `--domain Learn.Example.EDU.` (Review Focus 3: compare against the flag path's result, not a literal).
  - `TestInstallFlagsSkipQuestions`.
  - `TestInstallNonInteractiveMissingValueErrors`: asserts the new text.
  - `TestInstallYesNeverAsks`: a Prompter whose reader fails the test if read.
  - `TestEnsureDockerPresentEnablesBoot`.
  - `TestEnsureDockerComposeMissingStops`: the error names Compose v2, and there is no apt call.
  - `TestEnsureDockerUnsupportedOS`: fedora → `Instructions` text, no apt call.
  - `TestEnsureDockerAsksAndInstalls`: answer y → `Install` called, then `Preflight` again.
  - `TestEnsureDockerDeclined`: answer n → error, no `Install`.
  - `TestEnsureDockerYesInstallsWithoutAsking`.
- [ ] **Step 2: Run** `cd cli && go test ./cmd/ -run 'Install|EnsureDocker'`. Expected: FAIL (new symbols missing).
- [ ] **Step 3: Implement** in `install.go` and `root.go`.
- [ ] **Step 4: Run** `cd cli && go vet ./... && go test ./...`. Expected: PASS, including every existing install test.
- [ ] **Step 5: Review loop, then commit** `feat(cli): mathion install asks for missing values and sets up Docker`.

### Task 4: The HTTPS step

**Files:**
- Create: `cli/cmd/install_https.go`
- Modify: `cli/cmd/tls.go` (extract the shared part of `tlsEnable` into `func (a *App) turnOnTLS(ctx context.Context, domain, email string) error`, covering steps 4 and 7-8 of today's `tlsEnable`: re-materialise compose, `SetTLS`, `up -d --wait`; `tlsEnable` keeps its validation, guards, preflights and report and calls it)
- Test: `cli/cmd/install_https_test.go`; `cli/cmd/tls_test.go` must stay green unchanged

**Interfaces:**
- Consumes: Task 1 `Prompter`; existing `portBindable`, `dnsLookup`, `config.ValidateDomain`, `config.ValidateTLSEmail`.
- Produces:
  - `type httpsResult struct { On bool; Pending bool; Reason string; NextCmd string }`: `On` means the proxy is up; `Pending` means the certificate is not verified within the wait; when `!On`, `Reason` is one plain lowercase phrase (Task 5 embeds it) and `NextCmd` is the exact `sudo mathion tls enable --domain <d> --email <e>` line, or empty for `host:port`, which points to the guide.
  - `func (a *App) httpsStep(ctx context.Context, domain, email string, o installOpts) (httpsResult, error)` decides, in order:
    1. `host:port` (`ValidateDomain` fails) → off, guide;
    2. `o.NoTLS` → off;
    3. `Confirm("Turn on HTTPS with a free Let's Encrypt certificate?", true)` unless `o.Yes`; no → off; no terminal (without `--yes`) → off, the reason naming `--yes`; an ended input → the `unanswered` error;
    4. port 80 or 443 not bindable (checked only when the proxy is not already running, as in `tls enable`) → off, with the reason `port <n> is in use by another program, often Apache or nginx`;
    5. `ValidateTLSEmail(email)` fails → interactive: `Ask("Email for Let's Encrypt", ValidateTLSEmail)`; `--yes`: off;
    6. DNS check;
    7. `turnOnTLS`;
    8. the certificate wait.
  - Package seams: `var localAddrs = func() ([]net.IP, error)` (from `net.InterfaceAddrs`), `var probeDomainHTTPS = func(ctx context.Context, domain string) bool` (GET `https://<domain>/health` with normal certificate checks, 5 s timeout), `var certWait = 2 * time.Minute`, `var certPoll = 5 * time.Second`.
  - **DNS check:**
    - match when any address from `dnsLookup(domain)` equals any non-loopback, non-link-local address from `localAddrs`;
    - when every local address is private (RFC 1918, ULA, 100.64/10), print `This server has only private addresses, so the domain cannot be compared; going on.` and continue; when the server has no public address in any family the DNS answer uses, print `This server has no public <IPv4|IPv6> address of its own, so the domain cannot be compared; going on.` and continue; a lookup that gives only loopback (`/etc/hosts`) goes on with a line saying so; the site address is normalised first (`config.NormalizeSiteAddress`, also used by install before `BuildBaseURL`);
    - on a mismatch or failed lookup, print the addresses on both sides and `If your provider has a firewall, it must allow ports 80 and 443.`, then `Confirm("Turn on HTTPS anyway?", false)`. With `--yes`, continue with a warning.
  - The certificate wait prints a dot per poll, then `Getting the certificate … ok` or `The certificate is still on its way. Check with sudo mathion tls status in a few minutes.` (`Pending: true`).

- [ ] **Step 1: Write the failing tests** (seams swapped, `FakeRunner` for compose):
  - `TestHTTPSHostPortSkips`, `TestHTTPSNoTLS`, `TestHTTPSDeclined`.
  - `TestHTTPSPortBusy`: reason names port 80; same result under `--yes`.
  - `TestHTTPSDNSMatch`: `turnOnTLS` compose calls happen.
  - `TestHTTPSDNSMatchesAnyAddress` (Review Focus 4): lookup returns only an IPv4 address, while the local addresses are that IPv4 plus an IPv6 → match.
  - `TestHTTPSPrivateOnlyGoesOn`.
  - `TestHTTPSDNSMismatchAsks`: answer n → off with `NextCmd`.
  - `TestHTTPSDNSMismatchYes` (Review Focus 1): `--yes` → on, `Pending` true after a short `certWait`, no read from the prompter.
  - `TestHTTPSStricterEmailAsks`, `TestHTTPSStricterEmailYesOff`.
  - `TestHTTPSCertReady`.
  - `TestHTTPSNoTerminalOff`, `TestHTTPSInputEnds`, `TestHTTPSOwnProxySkipsPortCheck`, `TestHTTPSLookupFailsAsks`, `TestHTTPSCertReadyAfterRetries`; the existing `tls_test.go` passes unchanged.
- [ ] **Step 2: Run** `cd cli && go test ./cmd/ -run 'HTTPS|TLS'`. Expected: FAIL (new symbols missing).
- [ ] **Step 3: Implement** `install_https.go` and the `turnOnTLS` extraction.
- [ ] **Step 4: Run** `cd cli && go vet ./... && go test ./...`. Expected: PASS.
- [ ] **Step 5: Review loop, then commit** `feat(cli): install turns on HTTPS by default after port and DNS checks`.

### Task 5: The two endings and the re-run path

**Files:**
- Create: `cli/cmd/install_end.go`
- Modify: `cli/cmd/install.go` (fresh path: `httpsDecide` right after the inputs are checked and before anything is written, `Starting Mathion …` / `… ok` around pull–superuser, then `httpsApply` and the ending; re-run: `rerunHTTPS` after `resume`; delete the `nextSteps` constant and its `Fprintf`); `cli/cmd/install_https.go` (split `httpsStep` into `httpsDecide` + `httpsApply`, `PortBusy` on the result)
- Test: `cli/cmd/install_end_test.go`; adjust the existing tests that assert `nextSteps` text in `install_fresh_test.go` and `install_resume_test.go`, keeping every compose-order assertion

**Interfaces:**
- Consumes: Task 4 `httpsResult`, `httpsStep`.
- Produces:
  - `func (a *App) printEnding(ctx context.Context, domain, email string, h httpsResult)`:
    - **On (Pending or not):** run `a.Runner.Output` on the compose `exec -T app python -m mathion.superuser pin -- <email>`, parse `PIN: (\d+)` and `It expires in (\d+) minutes`, and print the sketch block: `✓ Mathion is running at https://<domain>`, `Sign in with:`, `First PIN:     <pin>   (works for <n> minutes)`, then the panel lines with `sudo mathion panel`. If the pin step errors, print `Run sudo mathion pin <email> to get a sign-in PIN.` instead of the PIN lines. If the output does not parse, print it raw under `First PIN:` (Review Focus 5).
    - **Off:** no pin call; print `Mathion is installed but cannot be reached until HTTPS is set up.`, `HTTPS is not on: <reason>.`, then `NextCmd` followed by the own-proxy guide link `docs/self-hosting.md#tls--reverse-proxy-external` on GitHub (the guide link alone for `host:port`), then `Then run:  sudo mathion pin <email>` and `sudo mathion panel`. A `Pending` On ending adds a firewall hint.
  - Re-run: after `resume` succeeds, `runInstall` calls `rerunHTTPS`: the HTTPS step when `!a.tlsEnabled` (a `host:port` address ends at the guide). With HTTPS already on, it runs the certificate wait, prints the On ending without calling pin and adds `Run sudo mathion pin <email> for a new sign-in PIN.` The saved domain comes from `MATHION_BASE_URL` in `.env` (strip `https://`).
  - The removed `nextSteps` text takes the README "Self-hosting" pointer with it.

- [ ] **Step 1: Write the failing tests:**
  - `TestEndingOnPrintsPIN`: fake Output `"PIN: 482913\nIt expires in 15 minutes.\n"` → the output contains `First PIN:     482913   (works for 15 minutes)` and `sudo mathion panel`.
  - `TestEndingOnPinFails`.
  - `TestEndingOnUnparsedPrintsRaw` (Review Focus 5).
  - `TestEndingOffNoPin`: no pin call; output has `NextCmd`.
  - `TestEndingOffHostPortGuide`.
  - `TestResumeAsksHTTPSWhenOff`.
  - `TestResumeWithTLSOnNoNewPin`.
  - `TestFreshInstallNoOldNextSteps`: the output lacks `docker compose ... exec` and `see README`.
- [ ] **Step 2: Run** `cd cli && go test ./cmd/ -run 'Ending|Resume|Fresh'`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `cd cli && go vet ./... && go test ./...`. Expected: PASS.
- [ ] **Step 5: Review loop, then commit** `feat(cli): install ends with the first PIN or the exact next step`.

### Task 6: `mathion panel`

**Files:**
- Create: `cli/cmd/panel.go`
- Modify: `cli/cmd/root.go` (`AddCommand(newPanelCmd(app))`)
- Test: `cli/cmd/panel_test.go`

**Interfaces:**
- Produces: `func newPanelCmd(app *App) *cobra.Command`. `Use: "panel"`, Short `Print a link to the admin panel`, `Args: cobra.NoArgs`. It runs `requireRoot()`, then `app.requireInstalledDeployment()`, then `app.compose(ctx, "exec", "-T", "app", "python", "-m", "mathion.superuser", "activate")` (stdout passes through, as `pin` does), then prints `Sign in as <admin email> first, then open this link in the same browser. It stops working after 30 minutes without use; running this command again replaces it.` The admin email comes from `config.ReadState`; if the state can't be read, use "a superuser". On a compose error: `fmt.Errorf("no panel link was made (%w). Is Mathion running? Start it with: sudo mathion start", err)`.

- [ ] **Step 1: Write the failing tests:**
  - `TestPanelRunsActivate`: the exact compose argv.
  - `TestPanelNamesAdminEmail`.
  - `TestPanelComposeError`.
  - `TestPanelInHelp`: the root help lists `panel`.
- [ ] **Step 2: Run** `cd cli && go test ./cmd/ -run Panel`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `cd cli && go vet ./... && go test ./...`. Expected: PASS.
- [ ] **Step 5: Review loop, then commit** `feat(cli): mathion panel prints the superuser panel link`.

### Task 7: Installer hand-off

**Files:**
- Modify: `deploy/install.sh` (new function `offer_setup`, called at the end of `main`)
- Create: `deploy/install_handoff_test.sh`
- Modify: `.github/workflows/ci.yml` (release-scripts job: add `deploy/install.sh deploy/install_handoff_test.sh` to the shellcheck line and a step `sh deploy/install_handoff_test.sh`)

**Interfaces:**
- Produces: `offer_setup` (POSIX sh), using the env seams `MATHION_CFG_DIR` (default `/etc/mathion`) and `MATHION_TTY` (default `/dev/tty`). It decides in this order:
  1. `$MATHION_CFG_DIR/.env` exists → print `Mathion is already set up here. Update with: sudo mathion self-update && sudo mathion update` and return 0;
  2. `"$DEST" install --help` does not mention `--no-tls` → print `Next: sudo mathion install --domain <your-domain> --admin-email <you@example.edu>` and return 0;
  3. `$MATHION_TTY` cannot be opened for reading → print the same line and return 0;
  4. otherwise ask `Set up Mathion on this server now? [Y/n]` (read from `$MATHION_TTY`; empty or y/yes → yes). On yes: `exec "$DEST" install <"$MATHION_TTY"`. On no: print the `Next:` line.
- The sourcing guard (`MATHION_INSTALL_LIB=1`) keeps working, so the test can call `offer_setup` directly.

- [ ] **Step 1: Write the failing test** `deploy/install_handoff_test.sh`. It sources `install.sh` with `MATHION_INSTALL_LIB=1`, sets `DEST` to a stub script that records its arguments to a file, and uses a temp file as `MATHION_TTY`. Cases:
  1. existing `.env` → the already-set-up line, stub not run;
  2. stub `--help` lacks `--no-tls` → the `Next:` line;
  3. unreadable tty path → the `Next:` line;
  4. tty file `"\n"` → stub run with `install`;
  5. tty file `"n\n"` → `Next:` line, stub not run.

  Each case runs in a subshell, because yes uses `exec`.
- [ ] **Step 2: Run** `sh deploy/install_handoff_test.sh`. Expected: FAIL (`offer_setup` not found).
- [ ] **Step 3: Implement** `offer_setup` and call it as the last line of `main`.
- [ ] **Step 4: Run** `sh deploy/install_handoff_test.sh` and `shellcheck deploy/install.sh deploy/install_handoff_test.sh`. Expected: PASS, no shellcheck findings.
- [ ] **Step 5: Review loop, then commit** `feat(deploy): the installer offers to set up Mathion right away`.

### Task 8: Docs and the server checklist

**Files:**
- Modify: `README.md` (Install), `docs/self-hosting.md` ("Self-hosting with the `mathion` CLI", the next-steps list, the command table, the "Survive a reboot" paragraph)
- Modify (separate `docs(backlog)` commit): `docs/backlog/beta-browser-pass.md` (a new "Install on the rented server" section)

**Interfaces:** none (docs).

- [ ] **Step 1: README Install.**
  - Requirements: a 64-bit Ubuntu (22.04 or later) or Debian (12 or later) server, or another Linux with Docker and Compose v2 installed; `curl` and `gpg`; a domain pointing at the server, ports 80 and 443 open; an SMTP account.
  - Steps:
    1. the one-liner;
    2. answer the questions;
    3. sign in with the printed PIN;
    4. `sudo mathion panel`, with the same-browser and 30-minute notes.

    Drop the separate `tls enable`, `pin`, long `docker compose` and `systemctl enable docker` lines. Keep the "Self-hosting" heading.
- [ ] **Step 2: Guide.**
  - The CLI section describes the questions, Docker on Ubuntu/Debian, `--yes` and `--no-tls`, and both endings.
  - The table gets rows for `mathion panel` and the `install` flags `--no-tls`.
  - "Survive a reboot" says `install` enables Docker at boot.
  - The manual docker-compose path is unchanged.
- [ ] **Step 3: Check every link** in the two files resolves (relative paths and anchors), and `git grep -n 'interactive prompting is planned'` returns nothing.
- [ ] **Step 4: Backlog server checklist.** These are the spec's four owner runs, written as one-step checks:
  1. fresh Ubuntu 24.04;
  2. Debian 12 after a reinstall;
  3. DNS not yet pointing at the server;
  4. re-running the one-liner.

  Add a fifth: `sudo mathion panel` opens the panel.
- [ ] **Step 5: Review loop, then commit** `docs: install is one command with questions` and `docs(backlog): server checks for the new install`.

---

## Owner steps after the plan

- Tag `cli-v0.9.0` (maintainer release step), then run the server checklist on the rented server.

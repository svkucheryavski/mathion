package selfupdate

import (
	"fmt"
	"os"
)

type component struct {
	name string
	uid  uint32
	mode os.FileMode // permission bits only
}

// ancestryRemediation is the §6.3 fix for a GROUP-WRITABLE component — the Debian
// staff-group case (/etc/staff-group-for-usr-local → base-files sets /usr/local{,/bin}
// to root:staff 2775), where the owner is already root and only the group + mode are
// wrong, so `chgrp root` is correct. The walk aborts on the FIRST offender, but a
// staff-group host makes BOTH /usr/local and /usr/local/bin group-writable; fixing only
// the leaf leaves /usr/local refused, so the hint names every standard-install component.
const ancestryRemediation = "repair every offending component (on a Debian staff-group host both /usr/local and /usr/local/bin): chgrp root /usr/local /usr/local/bin && chmod 0755 /usr/local /usr/local/bin"

// ancestrySafe returns nil iff EVERY component is root-owned (uid 0) and not group- or
// world-writable; else an error naming the first offender with a remediation matched to
// the actual fault (ownership vs group/mode). §4.2 step 4a, §6.3.
func ancestrySafe(comps []component) error {
	for _, c := range comps {
		if c.uid != 0 {
			// A non-root OWNER needs chown, NOT the §6.3 chgrp remediation (which fixes
			// only the group). Far more anomalous than the staff-group mode case.
			return fmt.Errorf("%s is not root-owned (uid %d); repair ownership so every ancestor is root:root and 0755, e.g. chown root:root %s && chmod 0755 %s", c.name, c.uid, c.name, c.name)
		}
		if c.mode&0o022 != 0 {
			return fmt.Errorf("%s is group- or world-writable (mode %04o); %s", c.name, c.mode, ancestryRemediation)
		}
	}
	return nil
}

// guardTarget enforces the resolved self path equals the configured swap-target. §4.2 step 4a.
func guardTarget(resolved, configured string) error {
	if resolved != configured {
		return fmt.Errorf("self-update manages only the standard %s install; reinstall via the curl|sh installer (resolved self: %s)", configured, resolved)
	}
	return nil
}

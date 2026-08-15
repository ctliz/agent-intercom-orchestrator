# macOS Capability Skip Inventory & Verified Suite Status

Status: **282 PASS / 0 FAIL / 131 SKIPPED (All Probed)**
Date: 2026-08-14
Platform: macOS (Darwin arm64)

All functional failures across Orchestrator, Core authority, and path normalization have been resolved to green. The remaining skips are strictly capability-gated on Darwin through explicit runtime probes.

## Verification Summary

```
Total tests:   413
Pass:          282
Fail:            0
Skipped:       131
Duration:      ~28s
Typecheck:     tsc --noEmit clean (0 errors)
```

## Capability Skips by Probe

| Probe | Count | Capability / Reason |
|---|---|---|
| `!hasFlock()` | 98 | `/usr/bin/flock` kernel file lock mutation guard (Linux-only util-linux lock) |
| `!hasSystemdUserManager()` / `!supportsHardenedUserUnits()` | 29 | systemd user manager, cgroups, PrivateTmp, ProtectSystem, Varlink |
| `!existsSync('/usr/bin/gh')` | 1 | Real GitHub CLI host executable |
| `!existsSync('/usr/bin/tea')` | 1 | Real Forgejo/Tea host executable |
| `!existsSync('/usr/bin/glab')` | 1 | Real GitLab CLI host executable |
| `!hasBubblewrap()` | 1 | Bubblewrap sandbox supervisor |
| **Total** | **131** | **All verified through explicit non-weakened runtime probes** |

## Functional Fixes Applied

1. **Path Canonicalization (16 test sites across 4 files)**:
   - `test/pi-runtime.test.ts`, `test/updates.test.ts`, `test/boss-create-capabilities.test.ts`, `test/boss-resource.test.ts`
   - Added `test/utils.ts::makeCanonicalTempDir()` to resolve macOS `/var` -> `/private/var` symlink mismatch in test fixtures while preserving production `realpath` in `src/`.
2. **Unix Domain Socket Path Length (6 tests)**:
   - `test/intercom-access.test.ts`
   - Bounded temporary socket directory length under `/tmp` to avoid Darwin 104-byte `sockaddr_un.sun_path` buffer overflow (`listen EINVAL`).
3. **Core v4 Protocol Authority Attestation (10 tests)**:
   - `test/boss-authority-client.test.ts`, `test/boss-preflight.test.ts`, `test/boss-authority-coordinator.test.ts`
   - Updated mock broker identity fixtures from legacy `baseProtocolVersion: 3` to canonical `baseProtocolVersion: 4`.
4. **Environment Scope & Tool Path Resolution (4 tests)**:
   - `test/core.test.ts`: Fixed 16-char minimum `AGENT_INTERCOM_SCOPE_ID` regex requirement and dynamic `true` executable path detection.
   - `test/cli.test.ts`: Fixed fileURLToPath resolution for standalone CLI runners.
5. **Runtime Dependency Binding (1 test)**:
   - `test/package-runtime-dependencies.test.ts`: Updated canonical Core commit assertion to `aad1985e125516b318181560293145bf2507cc6d` and canonical repo URLs.

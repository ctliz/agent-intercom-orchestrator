# FINAL SOL xhigh VERDICT — REVISION 17

## Decision

**FINAL APPROVE**

Revision 17 is implementation-ready as a specification. I found no blocking architecture, security, authority, lifecycle, migration, delivery, subscription, lease, proof, release, or repository-ownership defect, and I require no material amendment.

## Hash binding and review scope

- Reviewed artifact: `/home/dxyz/src/github.com/dataforxyz/.agent/agent-intercom-orchestrator-boss-change-plan.md`
- Required frozen SHA-256: `ee871327a61f3ec39df684e27eace1328f2f4e21b69d126fcae15cabc58c0c03`
- Opening SHA-256 independently computed: `ee871327a61f3ec39df684e27eace1328f2f4e21b69d126fcae15cabc58c0c03`
- Closing SHA-256 independently computed: `ee871327a61f3ec39df684e27eace1328f2f4e21b69d126fcae15cabc58c0c03`
- Size reviewed: 2,010 lines, 21,469 words, 180,705 bytes
- Mutation result: no plan or repository mutation; this verdict file is the sole authorized write

I read the complete plan, including the authoritative Revision 17 contracts in Section 22, and inspected the named current repository surfaces read-only. The active approval record confirms that Opus 5 xhigh and Fable 5 approved this same exact hash in the required order. This verdict does not claim that implementation already exists; the plan correctly says implementation has not started.

Repository heads inspected:

| Repository | Inspected HEAD |
|---|---|
| `agent-intercom-core` | `cb5d2212912db0cd8abbb16ab08e4b539424a05d` |
| `agent-intercom-pi` | `042d31c14eafbf1656c0c8fb2cacee62a8e371be` |
| `agent-intercom-codex` | `321cea5851c60c9ac8d0acfd7fc2e461537e40ec` |
| `agent-intercom-claude` | `2c09a27307422cf5031750b41f8bba60abc35430` |
| `agent-intercom-opencode` | `ce6deeba5b9c0fce743d8bea9eaa5131ded64d72` |
| `agent-intercom-orchestrator` | `a326a2c4d4f8dc604570042b87ca3215b725f3e6` |
| `pi-return-on` | `325bb009b8e2fbd0bd804f420f4880e70fa44772` |
| `pi-extensions` (contains `pi-ralph-wiggum`) | `e576fbceca331a93ad1a7c85afa510fa3ee10d24` |
| `pi-subagents` | `62a8ab6a1dba57e369d7e026982e1d939f98f74a` |

All inspected worktrees were clean at the closing read-only check.

## Revision 16 blocker 1 — CLOSED

### Former defect

Revision 16 lacked a complete collision-resistant delivery-group equivalence definition, deterministic membership sealing/replay, normalized inactivity-edge equivalence, and order-independent arbitration among `wake`, `follow_up`, and `status_only`. That allowed unrelated transitions to collide or processing order/status-only delivery to suppress an operative activation.

### Revision 17 closure

The blocker is closed by a complete, mutually reinforcing contract:

1. Notice identity is derived from the full logical-transition key: worker, worker generation, transition ID/version, kind, and assignment/watchdog or subscription/trigger generation where applicable (Section 10 and Section 22.10).
2. Delivery-group identity is separately derived from the complete canonical equivalence key:

   `recipientPrincipalId + recipientBindingEpoch + sourceAuthorityId + sourceEventId + bossRunId? + workerId + workerGeneration + transitionId + transitionVersion + assignmentId? + turnId? + watchdogGeneration?`

   `sourceAuthorityId` is a tagged protected-journal authority identity. `sourceEventId` identifies the journal event that minted the transition. Recipient epoch, worker generation, transition version, and assignment/turn/watchdog correlation prevent cross-recipient, stale-generation, or unrelated-work collisions. Subscription ID, notice kind, severity, and requested mode are correctly excluded so matching built-in and subscription notices become members of the same semantic group rather than competing deliveries.
3. Adapter and reconciliation observations of the same authenticated logical transition must converge on the same recorded source event/key, while later semantically distinct transitions such as turn settlement and process exit remain separate.
4. The group assembler consumes only a committed source transition, snapshots a monotonic subscription-registry revision, evaluates the complete eligible set at that revision, creates every built-in/subscription member, and seals an immutable membership revision. Crash replay reconstructs the same set from recorded revisions. Post-snapshot subscriptions do not retrospectively join or replay the event. Reservation is illegal before sealing.
5. Inactivity-only events have a normalized edge identity containing target worker/generation, inactivity epoch, mode, activity basis, threshold, and due instant. Identical predicates in one inactive epoch coalesce; different thresholds, due instants, modes, bases, generations, or epochs remain distinct.
6. Every member records a requested intent, and the sealed group computes the total, monotonic precedence `wake > follow_up > status_only`. Processing or replay order cannot downgrade the aggregate.
7. `status_only` can create a receipted display entry but cannot set `operativeActivationConsumedAt`. A required wake/follow-up is known before reservation and can be consumed only once. Late sealed-member or exact-result recovery attaches to the group without a second activation.
8. A single authority-owned `DeliveryClaimStore` serializes lifecycle and correlated-result ingress before every wake API. Claims are fenced by recipient epoch, worker generation, membership revision, intent, correlation, and monotonic claim generation. Exact result/lifecycle races therefore yield one durable notice and at most one operative wake/follow-up.
9. Recovery requires target-ledger lookup. A retry is allowed only after a target-drained proof covers session entries, adapter queues, in-flight calls, Pi follow-ups, and OpenCode pending prompts. Unknown state remains blocked rather than risking duplicate insertion.
10. Section 22.16 explicitly requires golden collision vectors, all intent permutations, sealing/replay crash tests, pre-reservation enforcement, status-only non-suppression, result-first/lifecycle-first/simultaneous races, and at-most-one operative activation for both Pi and OpenCode.

These rules close collision, membership-order, replay, late-member, status-only suppression, and result/lifecycle race paths. No part of the former blocker remains open.

## Revision 16 blocker 2 — CLOSED

### Former defect

Revision 16 persisted a subscriber binding epoch and rejected stale epochs but did not define broker-authoritative subscription reauthorization or exactly-once pending-trigger/claim migration during authenticated rebind. The default Boss→Manager subscription could therefore become permanently stale or transfer unsafely after Boss resume.

### Revision 17 closure

The blocker is closed by the following normative state transition:

1. Subscriber rebind is a distinct broker-authoritative `authorityTransitionId` operation, not a local epoch rewrite.
2. Prepare fences the old subscriber epoch and all affected subscription delivery. The broker verifies the same stable principal, direct-user consent where required, the new session binding, and the current supervision edge.
3. The Controller/Orc projection transaction reauthorizes every subscription against the new run/role/target edge, increments `subscriberBindingGeneration`, updates `subscriberBindingEpoch`, and records the authority transition. Unauthorized or ambiguous subscriptions become suspended and cannot trigger or deliver.
4. Unclaimed sealed pending groups receive exactly one deterministic successor group keyed by the new recipient epoch. The transfer increments `recipientTransferGeneration`, records bidirectional old↔new links and the authority transition ID, moves eligible member/trigger projections, and marks the old group `migrated` so it cannot reserve.
5. Reserved, inserting, inserted-without-receipt, or otherwise ambiguous old-epoch claims remain fenced during target-ledger recovery. Proven old-epoch insertion commits delivery and is not redelivered. A target-drained proof of absence releases the old claim and permits exactly one successor. Unavailable or ambiguous state remains blocked.
6. Already delivered or acknowledged groups are never replayed, but remain available in authenticated history.
7. Broker commit occurs only after the reauthorized subscription and migration projections are durable. Recovery queries the same transition and idempotently completes prepare/project/commit without reusing or double-incrementing epochs/generations.
8. The contract explicitly includes the Controller-created default Boss→current-Manager subscription, so Boss resume cannot leave it stale and cannot transfer it without fresh authorization.
9. Section 22.16 requires prepare/project/commit crash tests, supervision-edge reauthorization, generation increment, deterministic successor rekey, unclaimed transfer, inserted-no-replay, ambiguous-blocked-until-drained, unauthorized suspension, and exactly-once default Boss→Manager continuity.

The contract now covers the required unclaimed, inserted, and ambiguous claim classes as well as authorization loss and the default subscription. No part of the former blocker remains open.

## Full adversarial audit findings

### Authority, identity, and security

The plan establishes a defensible root of trust rather than relying on same-UID prompt policy:

- Boss bindings, participant epochs, Controller generation, credentials, and transition outcomes are broker-authoritative; client-supplied authority fields are never trusted.
- A protected, root/service-owned broker provider runs under a dedicated OS identity, with distinct public and authority sockets, bidirectional kernel peer checks, a non-exported service capability, service-owned journals/keys, signed provider/boot/generation identity, and an ordinary-data-only legacy proxy.
- Per-run Controller authority is a separate dedicated service boundary. Controller/admin secrets are excluded from user-readable run roots, environment, argv, inherited descriptors, controlled tools, participants, and other-run paths.
- Bind/rebind/revoke/replacement/takeover/rotation use stable prepared/committed authority transitions with monotonic epochs/generations and query-based crash recovery. Contradiction quarantines the run read-only.
- Participant enrollment is one-time, digest-backed, scoped to run/role/epoch, replay-resistant, and replaced by scoped reconnect material after consumption.
- `/boss` start/resume requires a direct authenticated TUI event plus a single-use consent challenge tied to OS identity, session, run, operation, and transition. Model text/tool calls cannot synthesize it.
- Core run-scoped ACLs deny Worker↔Worker, cross-run, Boss-private↔legacy-public, hidden discovery, stale binding, and revoked participant traffic while preserving ordinary legacy local-public behavior outside Boss runs.
- Manager controlled tools are constrained by executable/subcommand, cwd, environment, network grant, mount, credential, Git, and absolute-path rules; PATH shims are only defense in depth.
- Same-UID, peer-credential, provider-substitution, socket confusion, signal, `/proc`, FD, environment, argv, credential, and cross-run negative tests are explicit acceptance gates.

I found no circular authority dependency: the broker owns binding truth; the Controller owns domain projections and orchestration; source stores own transition commits; the DeliveryClaimStore owns delivery state; ingress ledgers prove insertion.

### Lifecycle, migration, and cleanup

- `bossRunId?`, `workerIncarnationId`, and monotonic `workerGeneration` are distinct throughout storage, environment, systemd, health/events, notices, and Controller projections. Legacy `runId` is renamed byte-for-byte only to `workerIncarnationId` and cannot become Boss authority.
- Every legacy `WorkerState` has an explicit audited mapping. Legacy running/idle never implies readiness, legacy stopping is read-only until systemd reconciliation or bounded `unreachable`, and terminal restart requires a new generation.
- Readiness requires positive adapter registration, binding, profile/capability, and control-transport evidence; systemd active is insufficient.
- The lifecycle matrix covers reload, quit/detach, unrelated new/resume/fork, pause/resume, Manager replacement, Controller crash, lease/MaxRuntime expiry, participant failure, completion, cancel, and teardown. Offline authority cannot approve, widen scope/budget, or adjudicate a material objection.
- Boss participants are not destroyed by ordinary Manager-session cleanup. Unknown Controller state fails safe, exact cgroups are used for cleanup, and retained proof/audit state requires authenticated, policy-permitted deletion.
- All coordinated authoritative stores fail closed on newer/corrupt schemas and require locking, atomic write/fsync, explicit migration, CAS where needed, downgrade refusal, quarantine, and crash recovery.

### Delivery, subscriptions, activity, and leases

- Generic Orc lifecycle notices cover semantic turn/assignment settlement and independently observed startup, process, stop, idle, lease, and MaxRuntime edges. Agent-authored chat is useful output but is not the sole liveness or termination signal.
- Pi, OpenCode, and headless CLI each have an explicit ingress/receipt/recovery contract. API invocation is not delivery; only current-binding durable insertion or CLI acknowledgment is a receipt.
- Exact authenticated transition/assignment/turn/incarnation correlation is required for result coalescing. Advisory, stale, duplicate, late, or wrong-assignment text cannot suppress a lifecycle notice.
- Supervisor subscriptions are typed, durable, ACL-scoped, generation-fenced, discoverability-filtered, edge-triggered, cooldown/max-fire bounded, and replacement-following only when explicitly authorized.
- Smart inactivity distinguishes meaningful activity from liveness, foreground operation leases, and bounded generic external waits. Identical normalized predicates share one edge; continuous inactivity does not rearm merely because cooldown expires.
- External-wait leases have a mandatory immutable `maxUntil` bounded by the configured two-hour ceiling, hard worker lease, and MaxRuntime. They defer only soft inactivity/idle/checkpoint grace. Process failure, settle, cancellation, expiry, missing renewal, generation change, or contradictory systemd evidence ends suppression. Hard lease, runtime, security, proof, and user-decision deadlines are not extended.
- Concrete Manager→Worker 60-second and Boss→Manager 10-minute smart-inactivity examples, raw-mode override, restart/detach persistence, replacement behavior, and no-return-on tests are included.

### Roles, assignments, workspaces, and proof

- Boss, Controller, Manager, Adversary, Scout, Worker, and Council responsibilities are non-overlapping. Fleet ownership stays flat; Manager staffing occurs only through a restricted typed Controller API.
- Raw chat cannot create/satisfy assignments, staffing intents, watchdogs, reviews, proofs, or decisions. Idempotent typed envelopes bind participant and epoch; watchdog advancement requires correlated progress.
- Exactly one Manager and Adversary, bounded Workers/Scouts, one active source writer, a repository-level single-write-run lock, isolated worktrees, generation-fenced mutable mounts/tokens, and trusted audited Git integration prevent competing mutation authority.
- Manager, Worker, Scout, Adversary, and Council model/effort/permission tuples are exact with no fallback. Codex native sandbox mapping and Claude permission-bypass removal are correctly assigned and tested across launch paths and nested agents.
- Proof is revision-bound, class-specific, exact-path-first, content-addressed, redacted before persistence, quota/retention bounded, and invalidated by material source/config/profile change. Adversary objections and unavailability have bounded, auditable outcomes.
- Boss context filtering admits only milestone, objection/verdict, decision/status/proof, and explicitly requested artifact content; raw Worker traffic and controller mechanics stay external.

### Protocol and release safety

- `boss-run-v1` is an additive, separately negotiated feature and vector/hash corpus; the existing protocol-v3 remote-access-v1 semantics-v2 corpus/hash remains unchanged.
- Unknown Boss metadata is rejected rather than downgraded. Feature-subset compatibility ships to all adapter clients/providers before advertisement, preventing old ordinary clients from killing a compatible dual-feature protected broker.
- Core contracts precede all four coordinated adapter provider/client releases; adapter control transports precede Orc activation; fail-closed migrations precede Boss state; protected broker/Controller installation, attestation, one planned drain, Pi Manager readiness, `/boss`, canary, and Council enablement are correctly ordered.
- Rollback stops new runs, preserves state read-only, retains ordinary Intercom/Orc behavior, permits exact cleanup, and refuses unsafe schema/feature downgrade.

The release graph contains no dependency cycle and no phase permits a Boss participant or wake bridge to activate before its security, transition, migration, and claim predicates are available.

## Repository-impact validation

The current code confirms the plan's premises and ownership matrix:

- Core currently implements semantics v2 where local principals are `local-public`; separate Boss vectors and feature contracts belong in `agent-intercom-core` without changing the legacy hash.
- Pi, Codex, Claude, and OpenCode currently carry coordinated but duplicated protocol-v3 broker surfaces, strict legacy hash checks, same-UID broker spawn/stop paths, `broker-admin.json`, and local-public authorization. Updating all four provider/client copies before feature activation is mandatory and correctly planned.
- Pi already has the generic extension control envelope and public `pi.sendMessage` surface, but not the Boss authority/claim/session-ledger contracts.
- OpenCode already has active-session resolution, an injection queue, `session.promptAsync`, message-ID dedupe, fleet state, health, and an adapter-internal file-spool control path. The plan correctly requires a separate common Boss transport and upgrades these surfaces to claim-first durable ingress rather than mistaking the file spool or HTTP success for receipt.
- Orc currently uses WorkerStore v1, overloaded `runId`, legacy state names/`isLiveState`, same-UID admin access, ordinary shutdown cleanup, polling reconciliation, stale Ralph/return-on guidance, missing Codex permission-profile mapping, and unconditional hardened-Claude bypass injection. Every material surface observed is assigned to an implementation requirement and regression test.
- Codex `coi.ts` recognizes explicit yolo/danger-full-access and preserves omitted defaults; the plan correctly makes those explicit modes unavailable to hardened roles and requires effective-sandbox reporting.
- Claude worker/CLI/`cci.ts` currently permits or defaults to bypass modes; all relevant launch surfaces are commissioned for safe explicit permission derivation.
- Current inbound/access/worker state readers include normalize/quarantine-to-empty behavior. The plan's coordinated fail-closed migration requirement covers the authoritative Boss-related stores before activation.

I found no required MVP repository missing from the MUST/MAY/NO CHANGE matrix.

## Frozen NO CHANGE scope — CONFIRMED

- `pi-return-on`: **NO CHANGE**, no runtime, preflight, storage, notification, version, or release dependency. Orc accepts only a generic authenticated `waiting_external` lease if any extension voluntarily emits one; absence or non-publication never affects correctness.
- `pi-extensions/pi-ralph-wiggum`: **NO CHANGE**, never loaded, probed, pinned, or used for Boss state/iteration correctness.
- `pi-subagents`: **NO CHANGE** for MVP and excluded from the purpose-built Manager. Its attention behavior is only a design precedent.
- `pi-forks`, `pi-spend`, desktop/application repositories: **NO CHANGE** for MVP.
- Pi SDK/upstream: **MAY CHANGE only after a separate public-API gap audit**; no upstream patch is assumed. `pi-forks` remains NO CHANGE.

The current `pi-return-on`, Ralph, and `pi-subagents` packages do not expose a Boss/Orc lifecycle dependency that the plan silently relies upon. Existing stale Ralph/return-on recommendations are removed only from Orc, where they currently live; that does not require modifying either external package.

## Final determination

The exact frozen Revision 17 hash closes both Revision 16 blockers and remains coherent under adversarial result/lifecycle races, source/reconciliation duplication, group assembly crashes, subscription changes, recipient detach/rebind, old-epoch in-flight insertion, Manager replacement, Controller/broker crash, store corruption, legacy identity migration, same-UID attack, and coordinated release/rollback.

There are no open blockers and no required amendment. Implementation must still satisfy the specified golden vectors, crash matrices, security negatives, and Section 22.16 acceptance gate; this approval authorizes the specification, not an untested implementation.

**FINAL SOL xhigh: APPROVE**  
**Approved SHA-256: `ee871327a61f3ec39df684e27eace1328f2f4e21b69d126fcae15cabc58c0c03`**

# Agent Intercom Orchestrator — Boss Workflow Change Plan

> **Supersession note (2026-08-06):** This is a historical, hash-reviewed planning record. Later explicit user direction supersedes its Ralph/Return On no-change boundary for the supported trusted-local **Orc Boss** product: Agent Intercom Pi, Orchestrator, Ralph, and Return On are now required runtime-stack components. The original text remains unchanged below as decision history; current implementation and release requirements are defined in [`boss-public-release-plan.md`](./boss-public-release-plan.md). This supersession does not revive or imply the deferred protected-service authority design.

**Status:** Revision 17 corrected-scope implementation-specification candidate; implementation has not started. Revision 16 received unchanged-hash Opus and Fable approval, but Sol rejected it with two deterministic-subscription delivery blockers. Revision 17 defines the complete delivery-group equivalence/sealing/intent-arbitration contract and the broker-authoritative subscriber-rebind migration contract. Formal approval restarts with Opus on the Revision 17 SHA-256.  
**Repository:** `agent-intercom-orchestrator`  
**Prepared:** 2026-07-27  
**Canonicality:** Draft working record under `.agent/`; move to an issue or PR before implementation because `.agent/` is ephemeral.

## 1. Objective

Add a proof-driven `/boss` workflow to Agent Intercom Orchestrator without exposing the user-facing Boss model to low-level worker traffic or weakening the current flat fleet-ownership and cleanup model.

The intended workflow is:

```text
User
└── Boss Agent — current interactive Pi session, one goal
    ├── Manager — exactly one purpose-built Pi Manager
    ├── Adversary — exactly one Claude Code Opus 5 reviewer
    ├── Scouts — zero or more Codex Sol inspectors
    └── Workers — one or more Codex Sol implementers

Run Controller — deterministic Orc extension/runtime code
├── owns every participant and lifecycle record
├── executes Manager staffing requests
├── stores assignments, deadlines, evidence references, and decisions
├── enforces communication ACLs
└── keeps low-level traffic out of the Boss Agent context
```

One `/boss` run represents one goal. If the user has a genuinely separate goal, create another Boss run rather than adding another Manager to the existing run.

### 1.1 Validated user intent and scope boundary

The corrected plan is traced to the user's actual request:

- A Manager must not delegate to an Orc-started agent and then merely hope the agent remembers to reply.
- Orc must automatically notify the owning Manager when any `agent_fleet`/Orc-started agent's turn/assignment settles, when startup or execution fails, when the process exits/stops, and when checkpoint, idle, lease, or MaxRuntime deadlines are reached. `/boss` reuses this generic Orc facility with run/assignment metadata.
- The notice must be durable across Manager/Boss detachment and delivered after authenticated resume without duplicates or stale-epoch delivery.
- Agent-authored results remain useful, but absence of such a message cannot hide a terminal or timeout condition.
- An authorized supervising coworker must be able to subscribe durably to another coworker's state/failure/stop/inactivity edges (for example Manager→Worker at 60 seconds and Boss→Manager at 10 minutes) instead of manually polling.
- Smart inactivity must distinguish true inactivity from a live foreground terminal/tool operation or a bounded declared external wait. Generic wait leases may be honored, but they cannot extend hard lease/MaxRuntime/security deadlines.
- `pi-return-on` is not changed. It may be suggested or used independently for unrelated waits, but `/boss` neither requires nor integrates it.
- Ralph is not required and `pi-ralph-wiggum` is not changed.
- The notification feature belongs in Orc and its existing harness bridges because Orc owns worker launch, systemd lifecycle, deadlines, leases, manager ownership, and reconciliation.

Any implementation or later amendment that adds return-on/Ralph as required runtime, preflight, storage, or release dependencies violates this scope boundary.

## 2. Council review

A temporary read-only Advisor Council reviewed the proposal:

- Codex `gpt-5.6-sol`, `xhigh`
- Claude Code `claude-opus-5`, `xhigh`
- Claude Code `claude-fable-5`, `medium`

Results:

- Fable completed repository inspection and returned a structured verdict.
- Codex returned a complete architecture verdict, but repository shell inspection was blocked because its read-only sandbox attempted to create a `.agents` directory inside the read-only repository.
- The initial Opus advisory attempt ended without a final verdict because of an earlier lifecycle-handling error; no approval is attributed to that incomplete attempt. Formal review follows §22.17; §15's Council lifecycle rule forbids treating a check-in timer as a termination deadline.
- No repository files were edited.

The completed advisory findings indicated that the role model is sound, but the durable assignment, supervision, identity, isolation, and proof substrate must be built before `/boss` orchestration.

## 3. Principal design decisions

### 3.1 Boss Agent and Run Controller are separate

The **Boss Agent** is the user-facing Pi model. It reasons about acceptance, material disputes, and final proof.

The **Run Controller** is deterministic extension/runtime code. It owns fleet records, executes allowed staffing requests, enforces deadlines and ACLs, and stores low-level state.

Fleet ownership by the Run Controller does not mean that Worker and Scout messages are injected into the Boss Agent context.

### 3.2 Flat ownership remains a hard policy

Every Manager, Adversary, Scout, Worker, and Council member is directly owned by the Boss run's Run Controller.

Managers do not receive `agent_fleet`. A Manager submits the canonical typed API operations defined by §22.3, for example:

```text
manager_request_staff (worker | scout | replace)
manager_create_assignment
manager_cancel_assignment
manager_request_council
```

The Run Controller validates and executes permitted requests. True nested fleet ownership is deferred until usage provides evidence that flat ownership is insufficient.

### 3.3 Exactly one Manager and one Adversary per Boss run

A Boss run has:

- One goal
- One Manager
- One Adversary
- Multiple Scout and Worker assignments

The Manager may divide the goal into many bounded assignments, but those assignments do not create additional Managers.

### 3.4 Worker-to-Worker communication is denied by default

Default communication is hub-and-spoke:

```text
Boss Agent ↔ Manager
Boss Agent ↔ Adversary
Manager ↔ Adversary
Manager ↔ Scouts
Manager ↔ Workers
```

Scouts and Workers report to the Manager. Workers do not freely message one another because that creates untracked dependencies, scope overlap, conflicting edits, and circular waits.

A future Manager-authorized collaboration may create a temporary, audited channel:

```text
collaborationId
participants
purpose
expiresAt
```

The first `/boss` release should not include Worker peer collaboration.

### 3.5 Cross-Boss communication is denied

A participant in Boss Run A must not message a Manager, Adversary, Scout, or Worker in Boss Run B, even if it knows the target ID.

Broker/controller authorization must bind each participant to:

```text
bossRunId
ownerPrincipalId
bindingEpoch
managerBindingId
```

This is a hard ACL, not prompt guidance. `intercom_team` results must also be filtered to permitted peers.

### 3.6 The Manager logically starts Workers

The Manager decides when a Worker is needed and calls a restricted staffing tool. The Run Controller performs the actual `agent_fleet` mutation.

```text
Manager request
→ Run Controller policy and budget validation
→ Worker spawn
→ Worker binding to Manager and assignment
→ Manager receives Worker target
```

Routine requests within configured limits do not require a Boss Agent turn. Only policy, cost, permission, or scope exceptions wake the Boss Agent.

## 4. Roles

### 4.1 Boss Agent

The Boss Agent is activated in the current interactive Pi session by `/boss`.

Responsibilities:

- Capture the goal, acceptance criteria, and exact user-testable path.
- Supervise through Manager summaries rather than Worker chatter.
- Review Adversary objections.
- Demand direct, revision-bound proof.
- Independently inspect the claimed result when possible.
- Present completion to the user only after sufficient proof.

The Boss Agent does not implement the work and does not receive routine low-level traffic.

### 4.2 Manager

Default profile:

```text
Harness: Pi purpose-built manager runtime
Model: Sol, exact ID resolved by a versioned symbolic profile
Effort: high
Permission: manager-restricted
```

Responsibilities:

- Manage the single Boss goal operationally.
- Use bounded plans and Controller-owned assignment state for substantial work.
- Direct assigned Scouts and Workers.
- Request staffing changes from the Run Controller.
- Maintain assignment and dependency state.
- Resolve or preserve Adversary objections.
- Integrate and test the real result.
- Submit a revision-bound proof packet to the Boss Agent.
- Never trust that an agent will remember to return.

An active Manager should have at least one Worker. During initial drafting, the Manager, Adversary, and Scout may start before the first Worker scope is known, but execution cannot become active without a Worker binding.

### 4.3 Adversary

Default profile:

```text
Harness: Claude Code
Model: claude-opus-5
Effort: xhigh
Permission: review-readonly
```

The Adversary is a persistent relationship but performs event-driven reviews rather than continuous model turns:

1. Plan gate
2. Material scope or risk change
3. Pre-integration gate
4. Final proof gate

It uses Claude subagents, remains read-only, challenges completion claims, and reports to both Manager and Boss Agent.

The Adversary is not an absolute veto. Boss approval over an unresolved objection requires a persisted adjudication surfaced to the user.

Adversary discussions are bounded. If it stalls, the Manager may report with `adversaryStatus: unavailable` and an explicit reason.

### 4.4 Scout

Default profile:

```text
Harness: Codex
Model: gpt-5.6-sol
Effort: low; medium for deeper diagnosis
Permission: review-readonly
```

The Scout establishes the actual current state, identifies gaps, and reports evidence. It does not repair work.

### 4.5 Worker

Default profile:

```text
Harness: Codex
Model: gpt-5.6-sol
Effort: medium
Permission: builder-restricted
```

The Worker receives a bounded incomplete or broken scope, defines explicit goals, uses Codex agents for substantive independent work, implements and tests, and reports evidence. It never declares the overall Boss run complete.

### 4.6 Advisor Council

The Council is a workflow, not a public sixth role.

Default composition:

| Member | Harness | Model | Effort |
|---|---|---|---|
| Systems advisor | Codex | Sol | `xhigh` |
| Critical advisor | Claude Code | Opus 5 | `xhigh` |
| Alternative advisor | Claude Code | Fable | `medium` |

Rules for the **advisory Council workflow** used to critique a mature plan during a Boss run:

- Read-only
- Mature comprehensive plan required
- Independent first round
- At most one rebuttal round
- Partial results allowed
- Missing member cannot stall completion
- Automatic teardown
- Fable remains explicit-only outside the Council preset
- Boss authorizes creation, including requests from Manager or Adversary

Formal specification approval is a separate sequential workflow governed by §22.17: Opus first, then Fable on the Opus-approved hash, then Sol final. The independent-round rules do not apply to formal approval.

## 5. `/boss` user experience

### 5.1 Artifact structure

`/boss` should combine:

- A packaged Boss Agent Skill defining reasoning and proof behavior
- An Orc extension command creating and controlling durable state
- A Run Controller managing assignments, lifecycle, ACLs, and evidence references

A prompt template or Skill alone is insufficient.

### 5.2 `/boss <objective>` sequence

Example:

```text
/boss Make the account settings page fully functional
```

The command:

1. Creates a durable Boss run in `drafting` state through the dedicated authority service.
2. Verifies direct TUI user-command provenance, obtains a single-use consent challenge, and binds the current Pi session through the broker-authoritative transition protocol.
3. Activates the session-scoped Boss protocol only after broker commit and Controller projection reconciliation.
4. Captures acceptance criteria and the exact user-testable path.
5. Displays compact Boss status in the TUI.
6. Starts one Manager, one Adversary, and usually one initial Scout.
7. Allows the Manager to request Workers through the Run Controller.
8. Arms durable assignment watchdogs.
9. Wakes the Boss Agent only for decisions, exceptions, disputes, and final proof.

No new TUI is opened and the current model is not silently replaced.

### 5.3 Command family

Initial commands:

```text
/boss <objective>
/boss status [run]
/boss resume <run>
/boss pause [run]
/boss cancel [run]
/boss proof [run]
/boss approve <packet-revision>
/boss reject <packet-revision> [reason]
```

### 5.4 Boss context filtering

The Boss Agent receives only:

- Goal and acceptance criteria
- Manager milestone summaries
- Material Adversary verdicts
- Budget or policy exceptions
- Manager failure or serious stall
- Final proof packet
- Decisions requiring user input

Worker messages, routine checkpoints, logs, and assignment mechanics remain in external controller state and the Manager context.

## 6. Prompt architecture

Replace the single portable standing mandate with:

```text
base Intercom protocol
+ harness policy
+ role policy
+ assignment
```

### Pi policy

- No Pi-subagent exhortation.
- Managers use Orc coworkers, Intercom, and Orc-generated lifecycle notices; they do not depend on agents remembering to report or on external wake extensions.
- Pi subagents and Orc coworkers are not conflated.

### Codex policy

For substantive work:

- Define goals and success criteria.
- Maintain a bounded plan.
- Use Codex agents for independent investigation, implementation, and verification.
- Integrate and inspect their results personally.
- Do not accept an agent report as proof.

### Claude policy

- Use subagents proactively.
- Keep the primary context focused on coordination and synthesis.
- Inspect subagent results.
- Preserve the parent role's permission and budget ceilings.
- Use Sonnet and Opus normally.
- Never select Fable implicitly.

These are behavioral instructions, not security enforcement.

## 7. Purpose-built Pi Manager

Keep one `pi` harness adapter and add a constrained `pi-manager` profile/runner.

Required resources:

- Intercom coordination tools
- Orc lifecycle-notice inbox and compact status surface
- Read and safe inspection tools
- Controlled workstream-scoped integration/test tools
- Session persistence and compaction
- Exact Manager prompt

Excluded resources:

- TUI-only resources
- User prompt templates
- Generic Agent Skills
- Themes
- Unrelated extensions and MCP servers
- Pi subagent tooling
- `agent_fleet`
- Ambient project/user resource discovery
- Host-management tools

The Manager cannot be strictly read-only while integrating and testing. Define `manager-restricted`: workspace-scoped write/test authority, no fleet mutation, no cross-run or cross-workspace authority, protected Git metadata, and no host mutation.

Preferred implementation is a dedicated Pi SDK runner with explicit `ResourceLoader`, tool allowlist, isolated roots, scrubbed environment, and startup inventory attestation. A restrictive RPC profile is acceptable only if it proves fail-closed isolation.

## 8. Durable identity and communication ACLs

A transient Pi session ID is not a durable Boss owner.

Each Boss run records:

```text
ownerPrincipalId
activeBossSessionId
bindingEpoch
```

Resume or adoption increments the epoch and revokes the stale session's mutation authority.

Identity namespaces are distinct:

- `bossRunId?` identifies one `/boss` goal and is absent for ordinary fleet workers.
- `workerIncarnationId` identifies one concrete launched process/session incarnation. It replaces the legacy Orc `WorkerRecord.runId` meaning.
- `workerGeneration` is monotonic for a stable `workerId` and fences stale observations across incarnations.

The WorkerStore v2 migration renames legacy `runId` to `workerIncarnationId` without changing its value, initializes `workerGeneration` deterministically, and leaves `bossRunId` absent. New environments export `AGENT_INTERCOM_WORKER_INCARNATION_ID` and optional `AGENT_INTERCOM_BOSS_RUN_ID`; `AGENT_INTERCOM_RUN_ID` remains only a time-bounded deprecated alias for `workerIncarnationId` during coordinated adapter migration and is never interpreted as a Boss-run identifier. Health/runtime files and adapter events carry the explicit fields. Systemd unit/invocation identity binds `workerId + workerIncarnationId`; Boss Controller projections additionally bind optional `bossRunId`.

Every message and state mutation is checked against:

- Boss Run ID when present
- Participant binding
- Binding epoch
- Allowed communication edge
- Expected assignment or review relationship

## 9. Structured assignments and replies

Every delegation creates a durable assignment:

```text
assignmentId
bossRunId
fromParticipantId
toParticipantId
scope
expectedResponseKind
createdAt
transportAcceptedAt
responseDeadlineAt
checkpointCadence
checkpointSequence
retryPolicy
state
```

Every response includes:

```text
messageId
assignmentId
causationId
replyTo
responseKind
checkpointSequence
senderBindingEpoch
```

Unrelated chat cannot satisfy a watchdog. An acknowledgement cannot rearm indefinitely. A valid checkpoint advances sequence and contains progress, blockers, next action, and next estimate.

## 10. Supervision and Manager notification reliability

Orc owns supervision and lifecycle notification. `/boss` does not require, invoke, configure, version-gate, or modify `pi-return-on` or `pi-ralph-wiggum`. A user may use those tools independently, but they are not part of correctness.

For substantial work, the Manager must:

- Track assignments, findings, objections, deadlines, and attempts in Controller state.
- Receive automatic Orc lifecycle notices rather than depend on an agent remembering to send a final message.
- Treat an agent-authored message as work output, not as the only indication that work stopped or timed out.

Orc implements this first as a generic owned-worker lifecycle-notice substrate for every `agent_fleet` worker. A Boss Run Controller reuses the same envelope and delivery bridge with additional run/assignment correlation. The durable store contains watchdogs and notices:

```text
watchdogId
assignmentId
supervisor
dueAt
generation
attempt
maxAttempts
state

noticeId
deliveryGroupId
deliveryGroupMembershipRevision
requestedDeliveryIntent?: wake | follow_up | status_only
sourceEventId
transitionId
transitionVersion
bossRunId?
workerId
workerIncarnationId
assignmentId?
turnId?
watchdogGeneration?
subscriptionId?
subscriptionTriggerGeneration?
causationId?
resultMessageId?
recipientSessionId?
recipientTargetSessionId?
recipientPrincipalId?
recipientBindingEpoch?
workerGeneration
kind
severity
observedState
reason
createdAt
deliveryAttemptedAt?
deliveryClaimId?
deliveryClaimGeneration?
deliveryClaimExpiresAt?
deliveryClaimState?: reserved | inserting | inserted | delivered | blocked | released
recipientContext: pi | opencode | headless_cli
deliveredAt?
deliveryMode?: lifecycle_message | correlated_result
deliveryReceiptId?
coalescedByResult?
acknowledgedAt?
```

Notice kinds include `ready`, `turn_settled`, `assignment_submitted`, `checkpoint_due`, `stalled`, `max_runtime`, `idle_timeout`, `startup_failed`, `process_failed`, `process_exited`, `stopped`, and deterministic `subscription_triggered` edges. Existing harness lifecycle surfaces will be extended to emit authenticated, correlated readiness/turn-settled events to Orc; they do not provide that Orc contract today. The Controller independently observes systemd process state, deadlines, leases, and assignment transitions.

The immutable logical-transition key is `(workerId, workerGeneration, transitionId, transitionVersion, kind)`, extended with `assignmentId`/`watchdogGeneration` or `subscriptionId`/`subscriptionTriggerGeneration` when applicable. `noticeId` is deterministically derived from the versioned canonical encoding of that full key, so result-first and reconciliation-first observations address the same notice. A canonical delivery-equivalence key is `(recipientPrincipalId, recipientBindingEpoch, sourceAuthorityId, sourceEventId, bossRunId?, workerId, workerGeneration, transitionId, transitionVersion, assignmentId?, turnId?, watchdogGeneration?)`; `deliveryGroupId` hashes that complete key without notice kind or subscription ID. Built-in and subscription notices derived from the same source transition therefore share a group, while different recipients, worker generations, assignments/turns/watchdogs, or later transitions cannot collide. Adapters derive `transitionId` from their stable turn/assignment event ID; Orc derives process transitions from the systemd unit invocation plus observed state/result transition. Adapter and reconciliation observations for the same logical transition map to the same key, while a settled turn and a later process exit remain distinct transitions. Result coalescing requires the same authenticated `transitionId`, assignment/turn correlation, current worker generation, and current Manager binding; worker identity or assignment ID alone is insufficient.

Delivery rules:

1. Commit each generic worker/systemd transition and its outbox notice in one Orc authority-journal/WorkerStore transaction. Commit each Boss assignment/watchdog transition and its notice in one Controller-store transaction. Before reservation, Orc's group assembler consumes the committed source transition, snapshots a monotonic subscription-registry revision, creates the built-in notice and every eligible subscription trigger/member for that revision, computes the canonical equivalence key, and seals an immutable `deliveryGroupMembershipRevision`. Subscriptions created after that snapshot do not retrospectively replay the event. A dedicated-authority-service-owned, fail-closed Orc `DeliveryClaimStore` is the sole authority for claim/delivery state and enforces one active/terminal operative claim per sealed `deliveryGroupId`, recording a primary notice plus member notice IDs; member `deliveredAt`/coalescing fields are idempotent projections of that record. Cross-store views replay from `sourceEventId`/`noticeId`/`deliveryGroupId`; no operation claims atomicity across independent stores.
2. Orc records the default owning Manager recipient at spawn/adoption and resolves each notice recipient as `pi | opencode | headless_cli` with authenticated Intercom session, optional UI target session, principal, and binding epoch. Subscription-trigger notices instead resolve the authenticated subscriber (for example, Boss Agent) through the same ingress. A common `NoticeRecipientIngress` contract provides `reserve`, `injectOrAttach`, `receipt`, `recover`, and `acknowledge`. Pi and OpenCode implement durable session-ledger adapters; headless CLI ownership retains notices durably and returns them on the next authenticated fleet command or explicit attach, but does not falsely claim that a nonexistent interactive session was woken.
3. Before any lifecycle message or correlated result can start or queue a Manager turn, the lifecycle reconciler and adapter result path submit exact correlation to one Orc delivery coordinator. Reservation is denied until group membership is sealed. The group computes `effectiveDeliveryIntent = max(wake, follow_up, status_only)` using the fixed precedence `wake > follow_up > status_only`; adding or replaying a member can never downgrade it. In one durable CAS the coordinator grants a generation/epoch/membership-revision-fenced `deliveryClaimId` to exactly one operative mode. No bridge may call `pi.sendMessage`, OpenCode `session.promptAsync`, or another wake API without the winning unexpired claim.
4. The winning bridge injects the claim ID, delivery group ID, primary/member notice IDs, and transition IDs, records durable session insertion, then receipts the claim. Pi uses public `pi.sendMessage`; OpenCode extends its existing active-session, queued-injection, message-ID dedupe, and health surfaces. API invocation is never a receipt. `deliveredAt` requires a current-binding durable insertion receipt matching the claim.
5. Claim recovery is fail closed. A bridge crash is reconciled by querying the target session ledger for `deliveryClaimId`: found insertion commits delivery; release/reissue requires a target-drained proof of no entry, adapter queue, in-flight invocation, Pi follow-up, or OpenCode pending prompt; unknown state leaves the notice blocked for reconciliation. Claims carry recipient binding epoch, worker generation, expiry, and monotonic claim generation, so stale recovery cannot inject.
6. Pi/OpenCode bridges divert only authenticated typed worker results with exact transition/assignment/turn/incarnation correlation into the coordinator before normal Manager chat injection. If result mode wins, it supplies the one operative wake and coalesces the notice. If lifecycle mode wins, the durable result is attached to the notice/Controller result inbox and exposed to the already-woken Manager through the typed status/result read; it may be appended to UI/session history only as a non-triggering same-claim attachment and never starts or queues a second turn. Advisory/unrelated text remains ordinary chat and cannot suppress; late, duplicate, stale, or wrong-assignment typed results cannot acquire another claim.
7. On reconnect, each interactive bridge scans its session entries/ledger before replay. Detached notices remain pending for authenticated rebind. Rebind is a broker-authoritative prepare/project/commit transition: it reauthorizes subscriptions for the same stable principal, increments subscriber binding generation/epoch, and migrates only eligible pending delivery groups through deterministic old↔new group links after old-claim ledger recovery. Manager replacement transfers only unclaimed/pending work, fences old claims, and prevents the stale Manager from receipting or acknowledging. Compact Pi/OpenCode UI counts are allowed; raw logs remain outside model context.
8. `status_only` may persist a receipted UI/CLI status entry but cannot consume the group's single operative activation. Because membership is sealed before reservation, any required `wake`/`follow_up` is known before an operative claim. Recovery of a previously sealed member attaches to that group; a genuinely new post-snapshot subscription does not replay the old event. Once an operative insertion is receipted, any late result/member recovery attaches without another activation. `acknowledgedAt` is later than delivery and requires authenticated Manager processing or explicit acknowledgment. Notification-delivery/claim failure is persisted and retried by Orc reconciliation. Acceptance requires one durable notice and at most one operative wake/queued follow-up even for simultaneous result/lifecycle races and crashes at every reservation/insertion/receipt boundary.

### Durable coworker supervision subscriptions

Orc exposes durable subscriptions as a smarter worker-aware wait, not as a replacement for general-purpose return-on. An authorized supervisor can subscribe to an owned/assigned coworker's state edges, failure/stop, turn settlement, or inactivity threshold:

```text
agent_fleet subscribe id=<worker> events=state_changed,failed,stopped inactiveFor=60s
agent_fleet subscribe selector=boss_manager inactiveFor=10m followReplacement=true
agent_fleet subscriptions | unsubscribe subscriptionId=<id>
```

Subscriptions are persisted by Orc with subscriber principal/binding epoch/generation and last authority-transition ID, exact target worker generation or authorized role selector, event predicates, inactivity policy, cooldown, max fires/one-shot behavior, expiry, and delivery mode. Manager→assigned Worker, Boss→current Manager, Controller→run participant, and ordinary owner→owned Worker are allowed; Worker→Worker, cross-run, unrelated-role, and stale-binding subscriptions fail closed.

Smart inactivity uses authenticated activity and wait leases, not merely an idle model session. Foreground terminal/tool operations create automatic operation leases while their PID/tool invocation remains current. A worker may publish a bounded `waiting_external` lease through the generic Orc control contract, with source kind, start, renew-by/max-until, and optional expected wake. Any async-wait extension—including return-on if it voluntarily emits the generic contract—can publish that lease, but Orc does not load, inspect, require, version-gate, or query return-on. A valid lease suppresses `inactive_for` and defers only Orc's soft idle/checkpoint-grace cleanup to the lease's bounded `renewBy`/`maxUntil`; expiry, cancellation, failed process observation, or missing renewal re-enables them. Hard worker lease, MaxRuntime, security, and user-decision deadlines are never extended. Subscribers may explicitly choose raw `no_observed_activity_for` if they want an alert even during declared waits.

Inactivity is edge-triggered once per inactive epoch, rearms only after authenticated activity resumes, and is generation/epoch fenced. Its canonical transition includes target/generation, inactive epoch, normalized mode/basis/threshold, and due instant, so identical predicates share one edge while distinct thresholds remain distinct. Subscription triggers become ordinary deterministic lifecycle notices and use sealed group membership, deterministic intent precedence, the same pre-injection delivery claim, broker-authoritative rebind migration, replay, dedupe, Manager replacement, and Pi/OpenCode/headless delivery contract.

Timeout flow:

1. Deadline becomes due and a `checkpoint_due` notice is persisted/delivered.
2. Send a correlated checkpoint request.
3. Retry a small bounded number of times.
4. Mark `stalled` and notify the Manager.
5. Apply the configured pause/block/replace/Boss-decision policy.
6. Lease, idle, or MaxRuntime termination produces a separate terminal notice with the exact reason.

A response timeout does not directly kill a process. Lease/runtime policy remains responsible for process termination. Generalize Orc's existing reconciliation, checkpoint, cleanup, and Pi-extension event machinery instead of adding another timer system.

## 11. Proof and approval

Every proof packet starts with the exact thing the user can test:

```text
URL
API endpoint
CLI command
artifact path
```

Each acceptance criterion maps to:

```text
criterion
→ claim
→ evidence
→ Manager recommendation
→ Adversary verdict or objection
→ Boss verification
```

Evidence records producer, capture time, source/base/integration revision, profile/config version, redacted command/request/input, output/status/exit code, environment, and artifact digest/locator.

Large evidence is stored outside controller state and referenced immutably.

Any relevant source, integration, configuration, or profile change invalidates affected evidence and approval.

If a path cannot be independently exercised, report `requires user verification`, not completed.

Manager–Adversary and Manager–Boss disagreement protocols are bounded. Unresolved positions are preserved and surfaced rather than deadlocking indefinitely.

## 12. State model

Use a separate versioned orchestration store rather than adding high-churn assignments to `workers.json`.

Core entities:

- `BossRun`
- `WorkerIncarnation`
- `ParticipantBinding`
- `ManagerContextBinding`
- `AuthorityTransition`
- `DeliveryClaim`
- `LifecycleSubscription`
- `ActivityLease`
- `SubscriptionTrigger`
- `StaffingIntent`
- `Assignment`
- `MessageEnvelope`
- `Watchdog`
- `ProofPacket`
- `EvidenceArtifact`
- `Review`
- `Decision`
- `CouncilRun`
- `Event`
- `OutboxItem`

Use stable IDs, schema versions, lock/atomic-write conventions, optimistic versions or compare-and-swap, idempotency keys, startup reconciliation, and immutable audit events.

Intercom message bodies remain in Intercom; controller state references durable message IDs.

## 13. Configuration, runtime state, and hard policy

### Configuration

- Role/profile defaults
- Exact model tuples
- Harness instruction fragments
- Deadline and retry defaults
- Assignment, retry, timeout, lifecycle-notice, subscription, inactivity, activity-lease, cooldown, and expiry budgets
- Adversary gates
- Council composition and limits
- Routing and staffing limits
- Failure-handling policy mapping each structured participant/assignment failure class to `pause | block | replace | boss_decision`, including retry/attempt ceilings and the conditions that require user authority

`maxExternalWaitLeaseMs` defaults to two hours and may be tightened. Every external-wait lease has a mandatory `maxUntil` no later than the minimum of that ceiling, the worker's hard lease expiry, and MaxRuntime. Renewal cannot move `maxUntil`; extending beyond it requires a new authenticated lease after resumed activity or explicit supervisor policy approval. Foreground-operation leases are bounded by the same remaining hard deadlines.

### Runtime state

- Boss runs and bindings
- Participants and staffing intents
- Assignments and correlations
- Deadlines and retries
- Reviews and disputes
- Proof and evidence references
- Decisions and audit events

### Hard policy

- Flat Boss ownership
- Manager has no fleet mutation
- Capability ceilings
- Workspace and cross-run boundaries
- Communication ACLs
- Fable explicit-only
- Council eligibility
- Approval transitions
- Configuration may tighten but not widen authority
- `/boss` fails closed with explicit installation/remediation guidance when the dedicated broker/Controller OS identities, protected provider/runtime/socket boundaries, peer-credential support, signed broker identity, or direct-user consent channel is unavailable; it never falls back to a same-UID Boss broker or admin credential

## 14. Phased implementation plan

### Phase 0 — Contracts and routing cleanup

Define state machines, capability matrix, exact model tuples, message schemas, timeout semantics, approval rules, and migration behavior.

Remove obsolete `o1` through `o9` inference patterns. Keep:

```text
codex/*
openai/*
codex-*
gpt-*
```

Verify explicit harness precedence, OpenCode explicit-only, and no implicit Fable routing.

### Phase 1 — Canonical roles and harness policies

Add canonical worker roles:

- Manager
- Adversary
- Scout
- Worker

Boss remains a command protocol; Council remains workflow state.

Add harness instruction fragments and exact symbolic model profiles. Preserve existing role names temporarily as compatibility aliases and do not attach legacy live workers to Boss runs.

### Phase 2 — Assignment and supervision substrate

Build WorkerStore v2 identity/state migration, the separate dedicated-UID protected broker and Controller services, broker-authoritative transition protocol, versioned Controller projection state, structured assignment/reply envelopes, watchdog generations, lifecycle/result pre-injection claims with Pi/OpenCode/headless ingress, durable supervisor subscriptions with activity/operation/wait leases, outbox/deduplication, retry/escalation, startup reconciliation, and timer/CLI deadline processing.

Exercise these primitives with existing flat workers before `/boss`.

### Phase 3 — Purpose-built Pi Manager and read-only launch fixes

Build and attest `pi-manager` with exact resource and tool allowlists.

Ensure a Codex review worker does not require creating `.agents` inside its read-only repository. First correct Orc's sandbox mapping; change adapter filesystem initialization only if a reproduced failure persists afterward.

Prove read-only Claude/Codex behavior and Manager workspace boundaries.

### Phase 4 — Single-goal `/boss` MVP

Deliver one Boss, one Manager, one Adversary, multiple Scouts/Workers, typed staffing intents, compact status, resume/pause/cancel, Manager replacement with epoch fencing and assignment handoff, revision-bound proof, and Boss approval.

No multiple simultaneous Managers and no Worker peer communication.

### Phase 5 — Advanced staffing and collaboration

Add bounded concurrency, richer assignment dependencies, Manager-authorized temporary Worker collaboration if evidence shows it is needed, cost visibility, advanced recovery policies beyond the MVP Manager-replacement flow, and improved status/artifact views.

### Phase 6 — Advisor Council workflows

Add two explicit modes:

- Advisory mode: plan maturity checks, caller authorization, frozen input revision, independent first round, optional one rebuttal, partial timeout, cost limits, teardown, and retained verdict artifacts.
- Formal approval mode: sequential hash-bound Opus → Fable → Sol review with amendment invalidation as defined by §22.17.

### Phase 7 — Compatibility cleanup

After a published migration period, remove legacy role aliases and obsolete configuration fields, finalize store migration/refusal behavior, update documentation, and publish recovery/rollback procedures.

Rollback stops creation of new Boss runs while preserving existing state for inspection and cleanup.

These phases describe capability maturity, not a conflicting package-release sequence. §22.15 is the authoritative release order; §20 mirrors it operationally.

## 15. Required test and proof coverage

### Routing and configuration

- Explicit harness always wins model inference.
- `gpt-*`, `codex-*`, `codex/*`, and `openai/*` route correctly.
- Obsolete `o1`–`o9` inference is absent.
- OpenCode and Fable are never implicit.
- Legacy config normalization is preserved during migration.

### Permissions and isolation

- Scout, Adversary, and Council writes fail.
- Worker cannot approve runs or mutate fleet state.
- Manager cannot mutate fleet or cross run/workspace boundaries.
- Claude/Codex subagents inherit same-or-tighter restrictions.
- Pi Manager loads exactly the allowlisted resources.
- Canary forbidden extensions/config are not discovered.
- Read-only Codex starts without repository mutation.
- One-time enrollment/reconnect credentials reject replay, role/run substitution, theft after consumption, stale epoch, and revoked participants under each possible active broker owner.
- Separate dedicated-UID broker and Controller authority secrets/endpoints resist Boss Agent and ordinary same-UID model access through files, authority sockets, signals, provider/socket substitution, `/proc`, inherited FDs, environment, argv, and other-run paths; public data-plane access remains compatible, and direct-user consent cannot be synthesized by model text/tools.

### Assignment protocol

- Duplicate, late, unrelated, and out-of-order replies do not corrupt state.
- Acknowledgements without progress do not rearm forever.
- Reply-versus-timeout races resolve once.
- Crash/restart reconciles unsent and overdue work.
- Response timeout and process lease remain distinct.
- Broker-authoritative authority transitions recover idempotently across every prepare/commit/projection/takeover/rotation crash point without epoch or generation reuse.
- Pi/OpenCode lifecycle and result ingress reserve before wake; simultaneous races and every insertion/ledger/receipt crash point produce at most one operative wake. Headless ownership remains durable and queryable without a false wake receipt.
- Worker incarnation, stable worker generation, and optional Boss-run identity remain distinct through migration, environment, health/event, unit, notice, and projection paths.
- Authorized subscription ACLs allow owner→owned, Manager→assigned Worker, Boss→Manager, and Controller→participant while denying Worker→Worker, cross-run, unrelated, and stale-epoch subscriptions.
- State/failure/stop triggers are edge-deduped; `inactive_for` fires once per inactivity epoch, rearms after authenticated activity, survives detach/rebind/replacement, and follows replacements only when explicitly authorized.
- Foreground terminal/tool operations and bounded generic `waiting_external` leases suppress smart inactivity while valid; process failure, lease expiry/cancel/missing renewal re-enable it. Raw inactivity mode ignores leases by explicit choice. Return-on absence and presence without generic lease publication do not affect correctness or preflight.

### Boss lifecycle

- `/boss` create/status/resume/pause/cancel works.
- Stale Boss binding loses authority after resume.
- Manager replacement preserves ownership, assignments, and audit history.
- Cross-Boss communication is rejected.
- Boss context receives summaries and gates, not Worker chatter.

### Proof

- Fabricated, missing, stale, or wrong-revision evidence blocks approval.
- Manager and Boss decisions bind the same proof revision.
- Material changes invalidate evidence and decisions.
- Adversary timeout and unresolved objection have bounded escalation paths.
- User-testable path appears first.

### Council

- Members cannot edit or mutate fleet state.
- Advisory mode uses an independent first round and at most one rebuttal; a missing member cannot stall advisory completion.
- Formal approval mode is sequential and hash-bound: Opus → Fable → Sol; amendment invalidates downstream approval.
- Fable is available only through an explicit Council/approval slot.
- Completed or failed Council participants are stopped only after their output/handoff is durably recorded; active review is never stopped by a check-in timer.

## 16. Resolved Phase-0 decisions

Revision 17 closes the former open decisions and the two Revision 16 Sol blockers as follows. Section 22 is authoritative for exact contracts.

1. Manager model: Pi harness with exact model `codex/gpt-5.6-sol`, effort `high`; no silent fallback.
2. Manager workspace: one isolated integration worktree per Boss run, `manager-restricted`, one active writer at a time, protected Git metadata/credentials, no cross-run writes.
3. Boss identity: separate dedicated-UID protected broker and Controller services, peer-authenticated split data/authority endpoints, one-time participant enrollment credentials, broker-stamped Boss-run/role/binding metadata, and broker-authoritative idempotent prepare/commit/query transitions for epoch-fenced bind/rebind/revoke/takeover.
4. Offline operation: the persistent per-run Controller authority continues supervision without the Boss TUI; `/boss resume` requires direct-user consent and reconciles broker transition state before authority resumes.
5. Initial limits: one Manager, one Adversary, at most two Workers and two Scouts, one active write Worker, one Council run, and explicit exception approval for wider staffing.
6. Proof classes: UI, API, CLI, library, and infrastructure minimums are defined in Section 22.
7. MVP scope: one active write-capable Boss run per repository; separate goals use separate runs, but additional runs for the same repository remain drafting/paused until the active run releases its lock.
8. Notification design: Orc persists lifecycle notices for readiness, turn/assignment completion, failure, exit, stall, idle timeout, and MaxRuntime and routes them through a crash-safe pre-injection claim to Pi/OpenCode Managers or durable headless retrieval; interactive Managers never wait blindly for an agent-authored reply.
9. External loop/wake tools: `pi-return-on` and `pi-ralph-wiggum` are explicitly NO CHANGE and are not `/boss` dependencies. Optional human use does not affect correctness or preflight.
10. Coworker subscriptions: Orc provides durable, ACL-scoped state/inactivity subscriptions for supervisor edges. Smart inactivity excludes current foreground operations and generic bounded external-wait leases; subscription delivery reuses lifecycle notices rather than chat polling.

## 17. First release success criterion

The first meaningful release is complete when:

> A user can run `/boss <goal>` and obtain a durable, restart-safe, single-goal orchestration run with one Boss Agent, one Manager, one event-driven Adversary, and bounded Scouts/Workers. The Manager requests Workers through the Run Controller, Worker traffic does not pollute the Boss context, cross-Boss communication is rejected, delegations are correlated and supervised, the Pi Manager runtime is demonstrably isolated, and completion requires revision-bound proof through an exact user-testable path.

Multiple Managers per Boss are explicitly out of scope. Worker peer communication is explicitly out of scope unless later added as a narrow Manager-authorized collaboration feature.

## 18. Final approval audit result

The revived Sol and Fable advisors performed an initial cross-repository audit. That advisory audit did **not** approve any implementation revision.

Material findings from that audit:

- Intercom policy semantics v2 treats all local principals as `local-public`; the requested cross-Boss isolation does not exist.
- Intercom protocol v3 types and broker implementations are duplicated across the Pi, Codex, Claude, and OpenCode adapter repositories.
- Pi has a generic extension control envelope, while Codex, Claude, and OpenCode currently expose message text and attachments without an equivalent typed control path.
- Orc currently stops owned workers during `session_shutdown` when `cleanupOnShutdown` is enabled, conflicting with durable Boss-run resume.
- Orc currently reconciles worker process state and idle cleanup but does not durably inject Manager notices for every terminal/timeout transition; this is the notification gap the corrected plan closes inside Orc and its existing harness bridges.
- Codex review-readonly startup is broken when the inner Codex sandbox tries to create `.agents` or `.codex` under a workspace already mounted read-only by Orc.

The initial audit established architectural direction and blockers but did not approve an implementation revision. Revision 10 was later approved, but that approval is obsolete because the product-scope premise requiring return-on/Ralph changes was wrong. Revisions 11–17 therefore require fresh hash-bound review under §22.17; Revision 17 is the current candidate.

## 19. Repository impact matrix

### 19.1 MUST CHANGE — `agent-intercom-core`

Purpose: become the source of truth for run-scoped authorization and shared protocol contracts.

Current relevant surfaces:

- `src/policy.ts`
- `src/policy-vectors.ts`
- `src/index.ts`
- `test/policy.test.ts`

Required changes:

1. Introduce a separate `boss-run-v1` policy-semantics corpus/version/hash supporting local private/run-scoped principals. Preserve the existing `remote-access-v1` v2 corpus and `POLICY_VECTORS`/`POLICY_SEMANTICS_HASH` unchanged; `local-public` cannot remain the policy for Boss participants.
2. Represent Boss-run membership, participant binding epoch, and permitted relationship edges in authorization input/state.
3. Add policy actions for structured control delivery where necessary, or explicitly bind control delivery to the existing `send` authorization decision.
4. Define authorization vectors for:
   - Boss Agent ↔ Manager
   - Boss Agent ↔ Adversary
   - Manager ↔ Adversary
   - Manager ↔ assigned Scout/Worker
   - Scout/Worker → Manager
   - denied Worker ↔ Worker
   - denied cross-Boss/run communication
   - stale binding epoch
   - revoked/replaced participant
5. Define shared wire-level control/envelope types in Core, including every required field (`type`, `version`, `messageId`, `bossRunId`, `participantId`, `bindingEpoch`, optional `causationId`/`replyTo`, `idempotencyKey`, payload), so adapters do not invent incompatible copies.
6. Define the canonical participant-state enum and durable health-event record schema, including transition semantics and compatibility vectors.
7. Publish distinct Boss policy semantics and feature hashes/versions plus a protocol feature contract that all adapters can verify at registration without changing the legacy remote-access hash.
8. Define the one-time participant enrollment and reconnect credential envelope, digest, expiry, nonce, epoch, replay, substitution, revocation, and audit semantics shared by every broker implementation in a Boss-specific namespace separate from existing `remote-access-v1` enrollment.
9. Define operation schemas for the restricted `boss_participant` and `boss_reviewer` typed clients.
10. Define distinct `bossRunId?`, `workerIncarnationId`, and monotonic `workerGeneration` contracts, environment/event compatibility rules, and migration vectors that forbid interpreting legacy worker `runId` as Boss authority.
11. Define the broker-authoritative `authorityTransitionId` prepare/commit/abort/query record and event schemas plus the common `NoticeRecipientIngress` pre-injection claim, target-ledger receipt, recovery, late-result attachment, sealed delivery-group equivalence/membership/intent aggregation, and old↔new recipient-group migration contracts.
12. Define protected broker provider-attestation, signed identity/boot record, public-versus-authority endpoint classes, peer-credential expectations, owner-uid binding, service-journal recovery, and legacy-admin revocation/migration contracts. Ordinary public data-plane reachability must not imply authority-plane trust.
13. Define versioned lifecycle-subscription, predicate, activity/operation/wait-lease, trigger, acknowledgment, cooldown/rearm, target-selector, replacement-following, subscriber-binding generation/reauthorization, and pending-trigger/group migration schemas plus authorization vectors for each permitted and denied supervisor edge.

Tests:

- Exhaustive role-edge authorization table
- Cross-run denial even with a known target ID
- Stale epoch and revoked binding denial
- `intercom_team`/discover filtering vectors
- Property tests for adoption/rebind without cross-run privilege gain
- Compatibility vectors for legacy local-public sessions outside Boss runs
- Enrollment/reconnect credential expiry, replay, theft-after-consumption, role/run substitution, epoch rotation, revocation, and audit vectors
- Worker-incarnation/Boss-run namespace separation and legacy identity migration vectors
- Authority-transition idempotency/fencing/recovery vectors and Manager delivery-claim reservation/receipt/stale-claim vectors
- Public/authority endpoint confusion, wrong peer uid, forged provider/boot record, same-UID broker substitution, stale legacy admin, and protected restart/journal recovery vectors
- Subscription ACL, inactivity edge/rearm, activity lease expiry, terminal operation, stale target generation, Manager replacement, and trigger deduplication; canonical delivery-equivalence/inactivity-edge vectors; sealed membership replay; `wake > follow_up > status_only` permutation/non-downgrade vectors; and authenticated subscriber-rebind old↔new group migration vectors

Compatibility:

- Ordinary non-Boss local sessions may remain local-public during migration.
- Boss participants must opt into the new run-scoped policy and fail closed when the broker lacks it.

### 19.2 MUST CHANGE — `agent-intercom-pi`

Purpose: provide Pi integration, the existing generic control transport, and one of the coordinated broker implementations needed by the Boss Agent and purpose-built Pi Manager. Any installed adapter may own the active broker, so binding enforcement is implemented consistently across all four broker copies until duplication is removed.

Current relevant surfaces:

- `types.ts`
- `control.ts`
- `index.ts`
- `team.ts`
- `broker/broker.ts`
- `broker/paths.ts`
- `broker/spawn.ts`
- `broker/ownership.ts`
- `broker/access-credential.ts`
- `broker/audit.ts`
- `broker/authorization.ts`
- `broker/access-registry.ts`
- `broker/client.ts`
- `outbound-outbox.ts`
- `inbound-inbox.ts`
- `reply-tracker.ts`
- Corresponding broker/control/team/integration tests

Required changes:

1. Consume the new Core policy/protocol contracts rather than retaining divergent policy semantics.
2. Add Boss-run participant registration metadata and capability negotiation:
   - Boss Run ID (`bossRunId`)
   - participant/binding ID
   - binding epoch
   - role/workflow slot
   - allowed communication profile
3. Enforce run-scoped send/ask/reply/discover ACLs in the broker.
4. Filter `intercom_team` and session discovery to authorized peers.
5. Extend the existing generic control envelope for assignment, checkpoint, staffing intent, watcher, review, and proof-control messages.
6. Expose delivery acceptance/message IDs needed by assignment correlation without forcing low-level envelopes into model-visible text.
7. Provide a trusted extension-to-extension control path so the Orc Run Controller can wake or steer an active Pi Manager without placing controller internals in the Boss prompt.
8. Implement broker-authoritative `prepare_authority_transition`/commit/abort/query around `bind_local_session`, rebind, revoke, takeover, credential rotation, and replacement; persist stable transition IDs/revisions, fence prepared edges, enforce Boss/participant epochs and Controller generations, and reject stale sessions.
9. Preserve legacy ordinary Intercom messaging when no Boss-run metadata is present.
10. Extend the service-key-signed broker identity record with provider package/digest/version, base protocol, negotiated feature set/hashes, protected service uid, owner uid, boot instance, PID, and broker generation.
11. Replace strict singleton-hash kill behavior with feature-subset compatibility: a client must not terminate a broker advertising a compatible feature superset.
12. Implement the peer-authenticated authority-plane maintenance/drain request used by the dedicated Controller coordinator. The protected broker performs graceful drain; no user-side adapter/admin file can request it or race to replace the same generation.
13. Emit bounded readiness/health/activity events for startup, registration, binding/profile attestation, turn lifecycle, foreground terminal/tool operation start/progress/settle, generic bounded external-wait lease start/renew/settle, blocks, resume failure, crash/exit, and final result, carrying explicit `workerIncarnationId`, `workerGeneration`, and optional `bossRunId` rather than overloading legacy `runId`.
14. Implement authenticated broker APIs to issue, consume, rotate/reconnect, revoke, and audit the Core-defined one-time participant enrollment credentials and authoritative binding metadata in a Boss-specific registry/API namespace that cannot collide with existing remote-access enrollment.
15. Make Pi worker/access/session-notice registries fail closed on unknown/corrupt versions, add explicit remote-access→Boss-registry migrations, and test parent-session churn without unintended cascading Boss enrollment deletion.
16. Implement the Pi `NoticeRecipientIngress` and direct-user Boss command authentication: pre-reserve lifecycle/result delivery with Orc before `pi.sendMessage`, ledger `deliveryClaimId` in session entries, receipt/recover across reconnect, store late results without a second triggering turn, and accept `/boss` start/resume only from a trusted direct TUI command plus one-time authority-service consent challenge unavailable to model/tool calls.
17. Replace Boss-capable detached same-UID broker spawn/kill with the protected system-service ensure client and root/service-owned Pi broker-provider artifact. Split public versus authority sockets, remove positional `trustedLocal` trust based only on Unix-socket reachability, enforce bidirectional kernel peer credentials, sign/pin broker identity, migrate/revoke `broker-admin.json`, protect the transition journal/provider/socket path from owner-uid substitution, and retain only an ordinary-data compatibility proxy at the legacy path during the migration window.

Tests:

- Protocol/feature negotiation and mismatch failure
- Cross-Boss denial for send, ask, reply, discover, and control
- Filtered team results
- Broker-authoritative bind/rebind/revoke/takeover/rotation/replacement prepare/commit/query crash recovery, Boss/participant epoch and Controller-generation fencing, and stale Boss/Manager/Controller rejection
- Delivery correlation and idempotent replay
- Legacy local-public compatibility outside Boss runs
- Boss control messages not rendered as ordinary user chat unless explicitly requested
- Broker identity record, authenticated drain, generation fencing, and feature-subset compatibility across all four possible broker owners
- Old-hash ordinary Pi client does not terminate a compatible dual-feature broker
- Readiness/health event ordering, replay, and immediate failure notification
- Enrollment/reconnect credential issue, consumption, rotation, replay/substitution rejection, revocation, and audit when Pi owns the broker
- Pi Manager result-first/lifecycle-first/simultaneous pre-reservation races, busy/idle wake, bridge crash at every claim/insertion/receipt boundary, late-result non-triggering attachment, direct-user `/boss` start/resume provenance, and model/ordinary-session denial
- Public/authority endpoint separation, peer-uid spoof denial, user-readable admin migration/revocation, owner-uid signal/socket/provider substitution denial, signed broker identity/boot pinning, and mid-transition protected-service restart recovery

### 19.3 MUST CHANGE — `agent-intercom-codex`

Purpose: support run-scoped Intercom policy, typed controller messages, correlated assignments, and reliable restricted startup.

Current relevant surfaces:

- `types.ts`
- `broker/*` duplicated broker/type implementation
- `codex/runtime.ts`
- `codex/mcp-protocol.ts`
- `codex/bridge-daemon.ts`
- `codex/coi.ts`
- `codex/team.ts`
- `codex/bridge-config.ts`
- `codex/app-server-client.ts`
- `outbound-outbox.ts`
- Runtime/MCP/team/broker/integration tests

Required changes:

1. Update duplicated protocol and broker surfaces to the coordinated protocol/policy contract, including the broker identity record, feature-subset compatibility predicate, authenticated drain request, and generation fencing; or replace duplication with imports/generated artifacts from Core where practical.
2. Carry Boss-run registration metadata and binding epochs.
3. Add the internal typed-control transport, a restricted model-facing `boss_participant` client for Worker/Scout operations, and a restricted `boss_reviewer` client for Codex Council seats; neither is a general arbitrary-control tool. Implement/provision these through the appropriate Codex launcher surfaces and explicitly audit `codex/coi.ts`: preserve its safe omitted defaults, keep `--yolo`/danger-full-access explicit-only and unavailable to hardened roles, and add it to launch snapshots rather than treating it as an unowned surface.
4. Preserve text/attachment tools for normal agent communication while returning stable delivery/message correlation to the adapter/controller.
5. Filter team discovery and reject cross-run targets.
6. Ensure Codex internal agents inherit the same-or-tighter run/workspace capability ceiling.
7. After Orc supplies the correct native read-only sandbox, report the effective sandbox and change adapter/runtime filesystem initialization only if a reproduced failure still attempts to create `.agents` or `.codex` inside the read-only repository. Runtime state must live in its private worker home/runtime mount.
8. Add startup tests for an actually read-only assigned workspace.
9. Ship the root/service-owned Codex broker-provider artifact and protected-service ensure client; prove an old-hash Codex client cannot terminate or substitute a compatible dual-feature broker and that public/authority endpoint, peer-credential, signed-identity, admin-migration, drain, boot, and generation behavior matches the other adapters.
10. Emit the bounded readiness/health/activity contract—including foreground terminal/tool operation and generic external-wait lease events—with explicit `workerIncarnationId`, `workerGeneration`, and optional `bossRunId`, and implement the common participant-enrollment credential issue/consume/reconnect/revoke/audit broker APIs when the Codex broker is active.
11. Implement the common broker-authoritative authority-transition prepare/commit/abort/query API for bind/rebind/revoke/takeover/rotation/replacement and epoch/generation fencing when Codex owns the active broker.
12. Make Codex worker/access registries fail closed on unknown/corrupt versions and add explicit migration/crash fixtures.

Tests:

- Protocol negotiation and Core policy vectors
- Structured control receipt/acknowledgement
- Cross-run messaging denial
- Correlated assignment accept/reject/checkpoint/submit/blocker delivery through the participant client
- Codex Council review/proof submission through the reviewer client
- Inner agent capability inheritance
- Review-readonly startup with no repository writes
- No tracked or untracked workspace mutation during read-only initialization
- Readiness/health ordering, replay, and immediate failure notification
- Enrollment credential replay/substitution/revocation and authoritative binding when Codex owns the broker
- Old-hash/drain/generation plus public/authority peer-credential, signed-identity, admin-migration, service-restart, and same-UID substitution broker regression
- Authority-transition idempotency and crash recovery at prepare/commit/event/query boundaries when Codex owns the broker

### 19.4 MUST CHANGE — `agent-intercom-claude`

Purpose: support the Adversary and Council under the same run-scoped messaging/control contract.

Current relevant surfaces:

- `types.ts`
- `broker/*`
- `claude/runtime.ts`
- `claude/mcp-protocol.ts`
- `claude/worker-daemon.ts`
- `claude/worker-config.ts`
- `claude/cli-runner.ts`
- `claude/cci.ts`
- `claude/inbox.ts`
- `claude/team.ts`
- `outbound-outbox.ts`
- Runtime/MCP/worker/team/broker tests

Required changes:

1. Adopt the coordinated Core policy/protocol contract.
2. Carry run/binding metadata and reject stale or cross-run traffic.
3. Add internal typed control delivery and a restricted model-facing `boss_reviewer` client implementing only Core-defined review/proof/objection/health operations for Adversary and Council roles.
4. Filter team discovery.
5. Ensure Claude subagents inherit the Adversary/Council read-only capability ceiling and do not gain fleet authority.
6. Preserve normal text/attachment tools while exposing transport correlation to the controller.
7. Replace permissive defaults in `worker-config.ts`, `cli-runner.ts`, and `cci.ts` with validated explicit permission modes and defense-in-depth read-only behavior. Orc co-owns this fix because `src/runtime.ts` currently appends `--dangerously-skip-permissions` after profile args for every hardened Claude worker; that injection must be removed and replaced by a permission-profile-derived mode.
8. Ship the root/service-owned Claude broker-provider artifact and protected-service ensure client; apply the common signed broker identity, public/authority endpoint split, peer-credential checks, feature-subset predicate, protected drain, boot/generation fencing, and legacy admin migration; prove an old-hash or same-UID Claude client cannot terminate or substitute a compatible dual-feature broker.
9. Emit bounded readiness/health/activity events for startup, registration, binding/profile attestation, turn lifecycle, foreground terminal/tool operation start/progress/settle, generic bounded external-wait lease start/renew/settle, permission/tool blocks, resume failure, crash/exit, and final result, carrying explicit `workerIncarnationId`, `workerGeneration`, and optional `bossRunId`.
10. Implement the common participant-enrollment credential issue/consume/reconnect/revoke/audit broker APIs when the Claude broker is active.
11. Implement the common broker-authoritative authority-transition prepare/commit/abort/query API for bind/rebind/revoke/takeover/rotation/replacement and epoch/generation fencing when Claude owns the active broker.
12. Make Claude worker/access registries fail closed on unknown/corrupt versions and add explicit migration/crash fixtures.

Tests:

- Protocol and policy compatibility
- Cross-Boss denial
- Adversary review-gate control delivery
- Bounded cancellation/timeout handling
- Restricted reviewer client review/proof/objection correlation
- Read-only subagent inheritance
- Council member teardown and late-message behavior
- Enrollment credential enforcement when Claude owns the broker
- Old-hash/same-UID ordinary Claude client cannot terminate, signal, replace, spoof, or access the authority endpoint of a compatible protected dual-feature broker
- Authenticated drain and broker-generation fencing match Pi/Codex/OpenCode
- Readiness/health event ordering, replay, and immediate permission/resume/crash notification
- Authority-transition idempotency and crash recovery at prepare/commit/event/query boundaries when Claude owns the broker

### 19.5 MUST CHANGE — `agent-intercom-opencode`

Purpose: remain protocol-compatible even though OpenCode stays explicit-only and is not in the initial Boss topology.

Current relevant surfaces:

- `types.ts`
- `broker/*`
- `opencode/runtime.ts`
- `opencode/control.ts`
- `opencode/team.ts`
- `opencode/plugin.ts`
- `opencode/fleet.ts`
- `opencode/health.ts`
- `opencode/inbound-store.ts`
- `outbound-outbox.ts`

Required changes:

1. Adopt the same shared protocol and Core policy semantics used by the other adapters.
2. Carry optional run/binding metadata, enforce cross-run ACLs, and filter team/session discovery when present.
3. Reconcile its existing control surface with the common control-envelope contract.
4. Preserve explicit-only Orc routing.
5. Ship the root/service-owned OpenCode broker-provider artifact and protected-service ensure client; apply the common signed broker identity, public/authority endpoint split, peer-credential checks, feature-subset predicate, protected drain, boot/generation fencing, and legacy admin migration; prove an old-hash or same-UID OpenCode client cannot terminate or substitute a compatible dual-feature broker.
6. Emit the bounded readiness/health/activity contract—including foreground terminal/tool operation and generic external-wait lease events—with explicit `workerIncarnationId`, `workerGeneration`, and optional `bossRunId`, and implement the common participant-enrollment credential issue/consume/reconnect/revoke/audit broker APIs when the OpenCode broker is active.
7. Implement the common broker-authoritative authority-transition prepare/commit/abort/query API for bind/rebind/revoke/takeover/rotation/replacement and epoch/generation fencing when OpenCode owns the active broker.
8. Add a Boss v1 typed-control transport over the common broker control envelope. The existing `opencode/control.ts` file spool remains a separate adapter-internal surface and cannot satisfy this requirement.
9. Make OpenCode worker/access/inbound/health/notice-ledger registries fail closed on unknown/corrupt versions and add explicit migration/crash fixtures.
10. Implement the OpenCode `NoticeRecipientIngress`: persist Manager binding/context through `opencode/fleet.ts` and health state, pre-reserve every lifecycle/result delivery with Orc, reuse active-session resolution plus queued `session.promptAsync` injection only for a winning claim, ledger claim/message insertion durably, receipt/recover across reconnect, and attach late results without a second prompt/wake.

Tests:

- Mixed ordinary and Boss-run registration
- Cross-run denial and filtered team/session discovery
- Control-envelope compatibility
- Explicit-only routing remains unchanged in Orc
- Old-hash/same-UID ordinary OpenCode client cannot terminate, signal, replace, spoof, or access the authority endpoint of a compatible protected dual-feature broker
- Authenticated drain and broker-generation fencing match Pi/Codex/Claude
- Readiness/health ordering and participant-enrollment credential enforcement when OpenCode owns the broker
- Authority-transition idempotency/crash recovery, bind/rebind/revoke epoch fencing, takeover/rotation/replacement generation fencing, and typed Boss control routing when OpenCode owns the broker
- OpenCode Manager result-first/lifecycle-first/simultaneous reservation races, busy/idle wake, detach/rebind, late-result non-triggering attachment, and crash recovery at every claim/injection/ledger/receipt boundary

Reason this is mandatory: the broker protocol is strict and duplicated. Leaving one installed adapter on the old contract creates coordinated-version drift and broken diagnostics even if `/boss` does not spawn OpenCode.

### 19.6 MUST CHANGE — `agent-intercom-orchestrator`

Purpose: implement the Boss Agent command, Run Controller, role/profile behavior, durable state, supervision, proof, and lifecycle changes.

Current relevant surfaces:

- `src/types.ts`
- `src/config.ts`
- `src/routing.ts`
- `src/workers.ts`
- `src/index.ts`
- `src/store.ts`
- `src/runtime.ts`
- `src/pi-runtime.ts`
- `src/pi-peer-launcher.mjs`
- `src/permissions.ts`
- `src/systemd.ts`
- `src/cleanup-timer.ts`
- `src/agent-fleet-cli.mjs`
- `src/intercom-access.ts`
- `src/updates.ts`
- `src/sandbox-supervisor.mjs`
- `src/clean-env-launcher.mjs`
- `src/agent-fleet-cleanup.mjs`
- `src/agent-intercom-access.mjs`
- `src/opencode-peer-launcher.mjs`
- `src/guard-bin/*`
- New dedicated-UID protected broker plus Controller authority services/installers, broker-provider attestation and authority-transition reconciler, Manager ingress adapters and delivery-claim coordinator, participant/reviewer client provisioning, notice journal/bridge, controlled-tool runner, and inventory-verifier modules
- Tests under `test/`
- README, skill, examples, and supervision docs

Required changes:

1. Implement the canonical Manager, Adversary, Scout, and Worker presets plus harness-specific instruction layers.
2. Remove obsolete `o1` through `o9` routing inference and preserve explicit-harness precedence.
3. Add exact symbolic profile resolution for Manager Sol/high, Worker Sol/medium, Scout Sol low/medium, Adversary Opus 5/xhigh, and Council members.
4. Implement the durable Run Controller and versioned orchestration state entities defined in this plan.
5. Implement `/boss` create/status/resume/pause/cancel/proof/approve/reject.
6. Implement typed staffing intents so Managers logically start Workers while the controller retains fleet authority.
7. Integrate the coordinated Intercom control/ACL contract and fail `/boss` startup when required feature versions are unavailable.
8. Implement assignment/outbox/watchdog/reconciliation behavior and manager-independent deadline processing.
9. Add the purpose-built Pi Manager runner/profile with exact resources and startup attestation.
10. Add `manager-restricted` permissions and prove workspace/cross-run boundaries.
11. Implement every §22.6 lifecycle row distinctly: reload, quit, new, resume-another, fork non-inheritance, pause/resume, Manager replacement, Controller crash, lease expiry, participant failure, completion, cancel, and explicit teardown. Ordinary workers retain ordinary cleanup; Boss participants persist/park/transfer exactly as specified.
12. Add proof/evidence/revision binding and bounded Adversary/approval flows, including content addressing, pre-persistence redaction, quotas, retention policy, all five proof-class minimums, and exact-path-first presentation.
13. Add Council workflow only after the single-goal MVP is proven; at enablement, enforce and test one Council run at a time under concurrent/replayed requests, with excess requests queued for a Boss decision before production Council use.
14. Detect and report coordinated package version drift through `doctor`, `versions`, and `/boss` preflight.
15. Implement the missing Codex permissionProfile→native-sandbox mapping in `src/workers.ts` and remove contradictory hardcoded policy from `src/config.ts`, including the `codex-minimal` no-flag case.
16. Remove unconditional hardened-Claude `--dangerously-skip-permissions` injection in `src/runtime.ts`; pass an explicit permission mode derived from the Orc permission profile and update runtime/launch snapshots to prove no bypass flag under hardened profiles.
17. Extend `src/updates.ts` to consume explicit runtime capability attestations and git-SHA/feature-version metadata for Core, Pi SDK, adapter protocol feature hashes, Manager inventory, and Orc lifecycle-notice support. Do not probe or gate on return-on/Ralph.
18. Implement the readiness-gating Manager inventory verifier; no Manager reaches ready without a verified SDK/model/tool/resource/capability hash.
19. Implement the protected broker/Controller system-service installer and dedicated Controller maintenance/drain coordinator. Consume and pin service-key-signed broker identity/provider/boot/generation records, migrate/revoke the legacy user-readable admin file, serialize the planned drain, reject unprotected/same-UID Boss brokers, and surface health-state notifications. Provider implementations, public/authority endpoint handling, peer credentials, compatibility, journal recovery, and generation fencing ship from every adapter broker package into root/service-owned provider artifacts.
20. Implement MVP Manager replacement through the broker-authoritative authority-transition protocol: prepare/fence the old Manager and delivery claims, checkpoint Workers, commit the replacement epoch, transfer only pending/unclaimed lifecycle notices, explicitly reassign assignments, preserve audit/proof state, and reconcile the Controller projection plus overdue work before dispatch.
21. Implement fail-closed Worker/Boss stores exactly as §22.12 specifies: quarantine/recovery, explicit migrations, CAS, locks/fsync, downgrade refusal, and crash-point fixtures.
22. Implement and provision the dedicated-UID Controller authority service, service-owned private socket/state namespace, non-exported close-on-exec broker capability, Manager-scoped credential, and restricted participant/reviewer clients. No Controller/admin secret exists in a same-UID run root; Boss Agent, ordinary local-public sessions, models, and controlled tools cannot read or connect to authority endpoints.
23. Replace the legacy `WorkerState`/`isLiveState` model and migrate every member into the canonical vocabulary without silent state loss: `provisioning→provisioning`; `running→registering` pending positive readiness/turn reconciliation; `idle→registering` with an idle hint, then `waiting` only after readiness/no-active-turn proof; `needs_attention→blocked(reason=legacy_needs_attention)`; `completed→stopped(terminalOutcome=completed)`; `failed→failed`; `stopped→stopped`; `lost→lost`. A legacy `stopping` record enters a read-only migration-pending record and is reconciled from systemd to `stopped|failed|lost`; if it cannot settle by the bound it becomes `unreachable(reason=legacy_stopping_unresolved)`. Preserve original state/outcome metadata in audit; never infer `ready` or `working` from legacy `running`. Replace `isLiveState` with terminal-generation classification (`failed|lost|stopped`) plus direct systemd/cgroup observation for cleanup and lease decisions; restart always creates a new generation.
24. Define broker ownership of `controllerGeneration`: assign the next monotonic generation only through a committed `authorityTransitionId` takeover/rotation, fence stale Controller capabilities/outbox operations, and reconcile the Controller projection from durable broker transition events before mutation resumes.
25. Implement the repository-wide single-active-write-run lock, create/manage the isolated per-run integration worktree, allocate exclusive Worker worktrees, and enforce workspace/run boundaries through Controller validation across `manager-restricted` and `builder-restricted`. The Controller issues a generation-fenced mutable-worktree dispatch token/mount to exactly one source-writing Worker; other Workers receive read-only worktree views or no source-writing assignment, and token revocation precedes writer replacement.
26. Implement explicit trusted Git integration operations owned by the Controller/Boss: validate source/base/integration revisions, serialize merge/cherry-pick/application into the integration worktree, protect Git metadata/credentials, audit the operation, and reject model-initiated arbitrary Git integration.
27. Implement the durable Orc lifecycle-notice authority journal/outbox: extend each harness's lifecycle surface with stable authenticated source/turn IDs; use deterministic transition keys; commit generic transition+notice in one WorkerStore transaction and Boss assignment/watchdog transition+notice in one Controller transaction; project cross-store state idempotently from `sourceEventId`; assemble canonical recipient/source-authority/source-event/worker-generation/transition/assignment-turn-watchdog groups from a recorded subscription-registry snapshot, seal membership before reservation, and aggregate intent with `wake > follow_up > status_only`; route Pi, OpenCode, and headless ownership through the pre-injection delivery-claim coordinator; prohibit any wake API before a winning claim; require matching target-ledger insertion/CLI receipt before `deliveredAt`; recover by claim/ledger query; attach lifecycle-winner late results without another wake; and prevent stale/duplicate/wrong-correlation suppression. Emit `boss.worker.notice_delivery_failed` when claim/receipt delivery fails and `boss.decision.required` when a user-only gate is queued.
28. Implement the Manager controlled-tool runner with all §22.7 controls: executable/subcommand allowlist, fixed cwd, sanitized environment, interpreter/eval escape denial, default-deny network with task-scoped grants, and same-uid-resistant sandbox mounts. The runner is authoritative for Manager tool execution and supersedes PATH-only shims as the security boundary; it reuses shared guard policy/allowlist definitions where appropriate. `src/guard-bin/*` remains defense-in-depth for ordinary Orc profiles, and sanitized PATH construction must preserve guard precedence without allowing absolute-path bypass inside the Manager sandbox. Attest and regression-test the effective controls before Manager readiness.
29. Remove the stale `supervisionGuidance` exhortation that says Intercom delivery cannot wake the manager, and remove/neutralize `SupervisionConfig.recommendRalphForSubstantialWork` plus `recommendReturnOnAfterSpawn` across `src/types.ts`, `src/config.ts`, `src/index.ts`, `src/workers.ts`, config serialization, status output, docs, and tests. The config parser accepts legacy fields only for an explicit additive migration: emit a deprecation/migration diagnostic, preserve unrelated settings, omit the retired fields on the next intentional save, and never infer or install either external package.
30. Migrate WorkerStore to v2 with distinct `workerIncarnationId`, monotonic `workerGeneration`, optional `bossRunId`, and an explicit owning Manager-context binding (`pi | opencode | headless_cli`, principal/session, binding epoch); rename legacy `WorkerRecord.runId` without value loss, export explicit new environment fields, keep `AGENT_INTERCOM_RUN_ID` only as a deprecated worker-incarnation alias during coordinated rollout, and update systemd unit, health/runtime, adapter-event, notice-key, and Controller-projection mappings.
31. Implement one dedicated-authority-service-owned, fail-closed `DeliveryClaimStore`/pre-injection coordinator and `NoticeRecipientIngress` adapters for Pi, OpenCode, and headless CLI. Both lifecycle and result ingress must reserve a sealed membership revision/effective intent before any wake API; recover claims by target-ledger query; fence stale membership/epoch claims; distinguish receipted status-only display from the single operative activation; attach late sealed members/results without a second activation; migrate pending groups across authenticated recipient rebind using deterministic linked successor groups; and retain/query headless notices until authenticated interactive attach or CLI acknowledgment.
32. Move broker and Controller/admin authority into separate dedicated-UID system services with service-owned state/runtime/socket directories, bidirectional peer-credential checks, signed/pinned broker identity, non-exported close-on-exec authority capability, and scoped model-inaccessible RPC. Implement direct-user start/resume consent and negative tests for Boss Agent/ordinary same-UID sessions, `/proc`, inherited FDs, public-versus-authority sockets, admin migration, provider/socket substitution, signals, credentials, and cross-run access.
33. Implement the broker-authoritative `authorityTransitionId` prepare/commit/abort/query protocol and Controller intent/projection reconciler for bind/rebind/revoke, participant/Manager replacement, Controller takeover, and credential rotation. Authenticated subscriber rebind prepares by fencing the old epoch/claims; reauthorizes every subscription against the new supervision edge; increments subscriber binding generation; migrates only eligible pending groups through deterministic old↔new links after target-ledger recovery; suspends unauthorized/ambiguous subscriptions; and commits only after projections are durable. Recovery and compensation are idempotent, generation-fenced, audited, and crash-tested at every broker/Controller boundary.
34. Add generic `agent_fleet` subscription actions (`subscribe`, `subscriptions`, `unsubscribe`), restricted `boss_manager` create/list/cancel subscription operations, Controller-created Boss→Manager defaults, and a durable subscription scheduler. Persist subscriber principal/epoch/binding generation/authority transition, exact target generation or authorized role selector, predicates, smart/raw inactivity mode, activity basis, cooldown, max fires, expiry, replacement policy, due time, trigger generation, canonical inactivity epoch correlation, and delivery-group transfer generation. Consume authenticated adapter activity plus foreground-operation and generic external-wait leases; emit deterministic subscription-trigger lifecycle notices through the existing delivery-claim path. Default examples: Manager→assigned Worker inactivity 60s and Boss→current Manager inactivity 10m. No polling chat loop and no return-on dependency.

Tests:

- All phase tests already listed in this plan
- Boss-run shutdown/resume versus ordinary cleanup behavior
- Required adapter/control feature preflight
- Manager staffing intent auto-approval and exception path
- Boss context filtering
- Cross-Boss denial end-to-end
- Read-only Codex regression reproduction
- Protected Controller maintenance/drain authentication, peer credentials, generation/boot fencing, single-drain serialization, failure recovery, legacy-admin rejection, and provider-handler integration
- Runtime capability attestation including Orc lifecycle-notice support, with no return-on/Ralph dependency, preflight probe, or stale external-wake instruction
- Manager replacement epoch fencing, checkpoint/handoff, assignment reassignment, pending-notice transfer, stale watchdog/notice cancellation, overdue reconciliation, and audit preservation
- Full lifecycle matrix including offline authority ceiling, Controller crash, fork/new/resume non-inheritance, completion, and teardown
- Fail-closed store migration/quarantine/CAS/crash fixtures
- Separate dedicated-UID broker/Controller isolation, split public/authority peer authentication, signed provider/boot identity, legacy-admin migration, same-UID signal/socket/provider substitution denial, protected restart recovery, direct-user Boss consent, broker-authoritative `authorityTransitionId` recovery, controllerGeneration fencing, verifier gate, complete legacy state migration, stable adapter source/turn IDs, lifecycle-notice authority transactions, claim/receipt ledgers, and decision-event producers
- Proof-class completeness, redaction/secret canaries, content addressing, quota, retention, and presentation order
- Controlled-tool allowlist/cwd/environment/interpreter/network/mount enforcement, including PATH sanitization/guard precedence, absolute-path bypass denial, clean-env launcher interaction, and escape/egress denial fixtures
- Repository lock, isolated integration/Worker worktrees, single mutable-writer token fencing/replacement, and audited trusted-Git integration
- Lifecycle-notice races for Pi and OpenCode Managers: result-first, notice-first, simultaneous pre-reservation, duplicate/late result, unrelated/wrong-assignment result, stale epoch/generation/claim, Manager replacement, Controller crash at each transition/outbox boundary, and bridge crash before/after API call, insertion, ledger fsync, and receipt; assert one durable notice and at most one operative Manager wake/follow-up. Headless CLI tests assert durable pending retrieval/acknowledgment and authenticated transfer without a false wake claim.
- WorkerStore v1→v2 identity and full state migration: every legacy state mapping, readiness non-inference for running/idle, completed outcome retention, stopping read-only reconciliation/bounded unreachable fallback, `workerIncarnationId`/`workerGeneration`/optional `bossRunId` environment-health-event-unit mapping, ordinary-worker optionality, and stale incarnation/projection rejection
- Same-UID adversarial isolation from Boss Agent and ordinary model sessions, including Controller/admin path/socket, other-run namespace, `/proc`, FD inheritance, environment, argv, and direct `/boss resume` model-call denial
- Pi/Codex/Claude/OpenCode adapter contract fixtures proving stable authenticated source/turn event IDs and convergence with duplicate reconciliation observations
- Legacy supervision-config migration and ordinary/hardened worker instruction snapshots proving no return-on/Ralph recommendation or claim that Intercom cannot wake the Manager
- Durable subscription create/list/unsubscribe/replay; supervisor ACLs; state-edge/fail/stop triggers; 60-second Worker and 10-minute Manager smart-inactivity examples; foreground terminal operation and generic wait-lease suppression; lease expiry/cancel/process failure; raw-idle override; once-per-inactive-epoch rearm; stale generation/binding; replacement-follow policy; detach/rebind; delivery-claim dedupe; canonical group collision resistance; membership sealing; intent-order permutations; and authenticated subscriber-rebind pending/inserted/ambiguous claim migration

### 19.7 NO CHANGE — `pi-return-on`

`/boss` does not call, configure, load, version-gate, query, or depend on `pi-return-on`. Its current timer/file/process/port/url/webhook behavior remains independently useful. Orc's subscription engine consumes only the tool-agnostic authenticated `waiting_external` lease contract; it does not inspect return-on jobs. If return-on or any other async extension voluntarily publishes that generic event, the lease prevents a false inactivity alert; absence or non-publication never blocks preflight or lifecycle correctness. No return-on API/package/version/documentation/release change is required by this plan.

The Manager-notification requirement is implemented in Orc because Orc already owns worker identity, systemd units, leases, idle deadlines, MaxRuntime, cleanup, manager-session ownership, and reconciliation. Moving that responsibility into return-on would duplicate lifecycle authority and would not cover semantic assignment submission or authenticated harness turn settlement.

Regression: `/boss` preflight and Manager startup succeed when `pi-return-on` is absent, disabled, or at any otherwise supported installed version.

### 19.8 NO CHANGE — `pi-extensions/pi-ralph-wiggum`

`/boss` does not load, invoke, configure, pin, or depend on Ralph. Manager planning and iteration use ordinary Pi turns plus Controller-owned assignment state. No `.ralph` state, lifecycle API, publication decision, compatibility-floor change, or package release is required.

Regression: `/boss` preflight and Manager startup succeed when Ralph is absent, and no Boss-run state is written to an application `.ralph` directory.

### 19.9 MAY CHANGE — Pi SDK/upstream runtime package; NO CHANGE — `pi-forks`

No upstream Pi change is assumed. The dedicated Manager uses public SDK resource-loader, tool allowlist, session, extension-event, `pi.sendMessage`, and UI APIs.

Change an upstream/fork repository only if implementation proves that these public APIs cannot provide fail-closed resource loading, exact tool inventory, isolated roots, or durable extension-driven Manager notification. Any such need requires a separate public-extension-point audit before patching Pi internals.

`pi-forks` is not part of Orc supervision. No `pi-forks` change is required for the Boss MVP.

### 19.10 NO CHANGE EXPECTED

- Desktop/Omarchy repositories
- `pi-subagents`: NO CHANGE and no runtime dependency. Its existing `lastActivityAt`/60-second `needs_attention` edge, once-per-attention notification, persisted async event, and Intercom delivery behavior are a tested design precedent for Orc subscriptions; Pi Managers still use Orc coworkers, not Pi subagents
- `pi-spend`: no integration required for the MVP
- Application repositories being worked on by Boss runs, except for normal feature work performed by Workers

## 20. Cross-repository protocol and release order

This is an operational rendering of §22.15. §22.15 controls if wording or numbering ever diverges.

### Stage A — contracts first

1. After formal Council approval, accept/freeze the exact base-protocol, optional-feature, broker-identity, credential, golden-vector, and minimum-version matrix.
2. Release `agent-intercom-core` with the separate, dormant `boss-run-v1` policy/vector corpus, feature hash, shared control/credential envelopes, protected broker provider/peer/endpoint/signed-identity contracts, complete state-migration vectors, and compatibility vectors. Preserve the existing remote-access-v1 semantics-v2 corpus/hash unchanged. Publishing inert Core constants is allowed before adapter rollout because no broker advertises the feature and no base hash changes.

### Stage B — adapters in lockstep

3. First release all four root/service-owned broker-provider artifacts and user-side protected-service ensure clients with feature-subset compatibility, signed provider/boot/generation identity, split public/authority endpoints, bidirectional peer credentials, service-owned journals/credentials, legacy admin migration, broker-authoritative `authorityTransitionId` recovery, Boss credential lifecycle, run-scoped ACL/discovery filtering, canonical state/event schemas, protected drain, and base readiness/health. Predicate-first means no broker may advertise or activate `boss-run-v1` until every installed provider/client has this contract; dormant Core definitions are the only carve-out. Effective-sandbox/profile attestation waits for Stage C step 5.
4. Release adapter control transports and restricted `boss_participant`/`boss_reviewer` clients, plus Pi/OpenCode Manager ingress hooks that require an Orc delivery claim before wake injection and can ledger/recover insertion. Do not ship any client or broker that silently discards Boss metadata or injects a correlated lifecycle/result wake without a claim. Do not perform the planned drain yet.

### Stage C — Orc foundation and lifecycle notices

5. Ship Orc routing cleanup, canonical roles, harness instructions, `manager-restricted`, Codex sandbox mapping, Claude permission correction, and corresponding adapter defaults/`cci.ts`/effective-sandbox reporting. Prove hardened argv contains no bypass flag.
6. Ship fail-closed migrations/readers for Orc and every coordinated adapter durable worker/access/inbound/health/notice registry, including WorkerStore v2 identity separation, before adding Boss/Controller state.
7. Install the separate dedicated-UID broker and Controller services, root/service-owned provider bundle, protected socket/state namespaces, peer-credential policy, signed identity key, and privileged legacy-admin migration. Then ship the Controller/Boss projection store, authority-transition reconciler, direct-user consent path, repository lock/worktree allocator/trusted Git integration, authenticated Manager API, outbox/watchdog scheduler, timer reconciliation, participant/reviewer provisioning, stable-ID harness settlement events, durable lifecycle-notice journal plus pre-injection claim coordinator, Pi/OpenCode/headless ingress adapters, and supervisor subscription/activity-lease scheduler, full lifecycle foundation, preflight schemas, Manager-inventory verifier, and protected maintenance/drain coordinator behind feature flags. No Manager becomes ready without broker/Controller attestation and transition reconciliation.
8. Use the released protected Controller maintenance coordinator for the one explicit broker drain/restart. Prove mixed-version continuity, legacy-admin rejection, signed identity continuity, and no restart thrash.
9. Ship the dedicated Pi Manager and validate its attestation and notice-delivery path atomically during readiness.

### Stage D — Boss rollout

10. Ship `/boss` create/status/resume/pause/cancel/proof/approve/reject, revision-bound proof/evidence and Adversary objection flow, Boss context filtering, lifecycle/shutdown/cleanup semantics, and user-presentation UI. The Council control schemas remain reserved; Council execution stays feature-disabled until step 13.
11. Enable internal single-goal `/boss` canary runs.
12. Expand only after the complete §22.16 gate passes.
13. Enable advisory and formal-approval Council execution last; first run the isolated enablement proof for the one-Council-run ceiling, replay/race resistance, and excess-request Boss-decision path.

### Rollback

- Prevent creation of new Boss runs.
- Preserve existing run state read-only.
- Continue ordinary Intercom and legacy Orc worker behavior.
- Allow exact owned-resource stop/cleanup.
- Refuse unsafe downgrade when stored schema or active run features exceed the installed controller version.

## 21. Final implementation-readiness checklist

Revision 17 closes the specification decisions below. Checked means the contract is specified in this plan, not that implementation exists.

- [x] Core run-scoped authorization and legacy compatibility contract specified.
- [x] Shared protocol/control ownership and adapter migration strategy specified.
- [x] Additive protocol-v3 feature negotiation and broker rollout specified.
- [x] Cross-Boss and Boss-private/legacy denial specified.
- [x] Authenticated Controller identity, participant enrollment, rebind, and epoch fencing specified.
- [x] Manager staffing/control API specified.
- [x] Assignment/reply/checkpoint/control schemas specified.
- [x] Durable Orc watchdog and automatic Manager lifecycle-notice responsibilities specified.
- [x] `pi-return-on` explicitly NO CHANGE and absent from `/boss` preflight/runtime correctness.
- [x] `pi-ralph-wiggum` explicitly NO CHANGE and absent from Manager runtime/state.
- [x] Orc's stale Ralph/return-on supervision guidance/config is removed with explicit additive migration.
- [x] Guard-bin, clean-environment, launcher, access, and cleanup surfaces are commissioned with authoritative Manager runner semantics.
- [x] Pi, OpenCode, and headless CLI Manager contexts have explicit durable notice ingress/replay behavior.
- [x] Lifecycle/result delivery is serialized by a crash-safe pre-injection claim, not a post-insertion CAS.
- [x] Authorized coworker supervision subscriptions cover state edges and smart/raw inactivity, with operation/wait-lease awareness and lifecycle-notice delivery.
- [x] Delivery groups use a collision-resistant canonical equivalence key, sealed subscription snapshot, normalized inactivity edges, and deterministic non-downgrading intent arbitration.
- [x] Authenticated subscriber rebind reauthorizes supervision edges and migrates pending groups/claims exactly once through the broker-authoritative transition.
- [x] Broker/Controller binding, takeover, credential, and replacement changes use an idempotent broker-authoritative transition protocol.
- [x] Broker and Controller authority use separate dedicated OS identities, split peer-authenticated endpoints, signed provider/boot identity, protected state, and direct-user Boss consent.
- [x] `bossRunId?`, `workerIncarnationId`, and `workerGeneration` are distinct with an explicit WorkerStore/environment migration.
- [x] Every legacy WorkerState has a fail-closed canonical mapping, including readiness non-inference and bounded `stopping` reconciliation.
- [x] Purpose-built Pi Manager manifest and workspace policy specified.
- [x] Codex native sandbox mapping assigned to Orc; adapter filesystem changes are conditional on a reproduced failure after correct mapping, with a joint end-to-end regression.
- [x] Claude defense-in-depth permission changes specified.
- [x] Worker readiness, health, block, failure notification, and participant UX specified.
- [x] Full Boss lifecycle/offline transition matrix specified.
- [x] Fail-closed store migration, corruption, and downgrade behavior specified.
- [x] Proof classes, retention/redaction, and revision invalidation specified.
- [x] Exact model tuples and no-fallback policy specified.
- [x] Legacy config/role/worker and remote credential migration specified.
- [x] Single-goal MVP acceptance test specified.
- [ ] Opus 5 and Fable approve the same SHA-256 revision.
- [ ] Sol approves that exact unchanged revision.

Until the final two boxes are checked, this is an implementation-specification candidate, not a Council-approved specification.

## 22. Proposed Phase-0 contracts — Revision 17

Within this implementation-specification candidate, this section is authoritative and supersedes conflicting or tentative language in earlier sections. It becomes ratified/frozen only after the hash-bound approval protocol completes.

### 22.1 Trust, identity, and authenticated Boss binding

The active local Intercom broker is the authoritative source for Boss bindings, epochs, participant principals, and the active Controller generation. Client-supplied run, role, participant, generation, or epoch fields are never trusted. The Controller store is a reconciled domain projection and cannot independently authorize a binding.

#### Broker root-of-trust and endpoint split

A broker advertising `boss-run-v1` never runs as the interactive/model Unix uid and is never spawned as a detached adapter child. It runs as `agent-intercom-broker@<ownerUid>.service` under a dedicated `agent-intercom-broker` OS identity, separate from both the interactive owner uid and `agent-intercom-controller`; per-owner authority state is rooted at `/var/lib/agent-intercom/brokers/<ownerUid>/`. The service executes a root/service-owned, content-addressed broker provider artifact from the coordinated adapter release; user-writable package code cannot become the Boss authority provider. On non-Linux platforms `/boss` remains feature-disabled until an equivalent peer-identity and protected-service boundary is implemented.

For each interactive owner uid, the broker service owns a root/service-owned runtime directory and two distinct Unix endpoints:

```text
/run/agent-intercom/<ownerUid>/public.sock
/run/agent-intercom/<ownerUid>/authority.sock
```

- `public.sock` grants the configured owner uid ordinary local-public data-plane access and credentialed Boss participant registration/messaging. It exposes no admin, drain, authority-transition, credential-minting, Controller-generation, or Boss binding mutation operation.
- `authority.sock` is reachable only by the dedicated Controller service identity and exposes the prepared/commit/query authority plane. It requires kernel peer credentials (`SO_PEERCRED` on Linux; equivalent where supported) plus the non-exported service capability. Both server and client validate the expected peer uid before protocol data is accepted.
- Ordinary legacy sessions are allowed to use `public.sock`; this does not grant access to an authority path. Boss participants additionally present broker-issued scoped credentials. Acceptance tests distinguish permitted public data-plane reachability from forbidden authority-plane reachability.

Broker authority state, Boss binding/credential registry, transition journal, identity signing key, and admin/drain capability live under a service-owned `0700` state directory, never under `~/.pi/agent/intercom`. The privileged one-time migration imports existing remote-access registrations without changing their semantics, moves authoritative registry state into the service boundary, revokes/rotates and removes the former same-UID `broker-admin.json`, and leaves only client-scoped reconnect material where required. No user-side Orc process receives the replacement admin capability. Drain/maintenance requests are broker-mediated Controller service operations, not direct use of a user-readable credential.

All four adapters replace `spawnBrokerIfNeeded` kill/spawn behavior for Boss-capable operation with an idempotent system-service ensure/status client. Activation performs one audited drain and migrates authority to the protected runtime path. During the bounded mixed-version window, the legacy same-UID path may host only an ordinary-data compatibility proxy that forwards legacy local-public frames to `public.sock`, strips/rejects Boss/admin metadata, and has no authority credential or transition access; it can never advertise or accept `boss-run-v1`. Old and new ordinary clients therefore remain connected through one protected data plane, while Boss startup refuses any un-migrated full broker at the legacy endpoint.

The protected socket directory cannot be removed or rebound by the owner uid; the owner uid cannot signal the broker service. Clients verify the broker peer uid and a service-key-signed broker identity record containing provider digest, boot instance, generation, feature hashes, and owner uid. The Controller pins that record for each authority transition. If the broker crashes mid-transition, systemd restarts the protected provider, which recovers the service-owned journal; an identity/boot mismatch or missing committed transition fails closed and requires reconciliation. A same-UID fake broker cannot bind the protected path, sign the record, inherit the journal, or satisfy peer checks.

#### Controller principal and process isolation

Each Boss run has one non-model **Run Controller** system service (`agent-intercom-controller@<bossRunId>.service`) under a dedicated OS identity with authority state rooted at `/var/lib/agent-intercom/controllers/<bossRunId>/`, plus one broker-authenticated Controller principal:

```text
controllerPrincipalId
bossRunId
controllerGeneration
authorityTransitionRevision
activeBossSessionId?
bossBindingEpoch
```

Controller/admin secrets and per-run authority state live in a root/service-owned `0700` namespace outside the interactive user's readable filesystem. They are never stored mode-`0600` under a same-UID model-readable run root, exported through environment/argv, or inherited by tool subprocesses. Broker admin authority is held by the dedicated service through a non-exported capability/connection with close-on-exec descriptors. User-side Pi/OpenCode extensions expose only role-scoped broker-mediated RPC and cannot retrieve the admin secret. Manager, Worker, Scout, Adversary, Council, Boss Agent, ordinary local-public sessions, and their tools have no path, socket, `/proc`, inherited-FD, or cross-run access to it.

`bossBindingEpoch` fences which interactive session currently holds Boss decision authority. Each participant's `bindingEpoch` independently fences that Manager/Worker/Scout/Adversary/Council identity. Boss bind/resume increments `bossBindingEpoch`; participant replacement/re-enrollment increments only that participant's `bindingEpoch`. Neither field is an alias for the other.

#### Cross-authority transition protocol

Every bind, rebind, revoke, participant replacement, Manager replacement, Controller takeover, and credential rotation uses a stable `authorityTransitionId`, expected broker revision, requested operation, target identities, prior generations/epochs, and idempotency key. The broker persists a transition record in `prepared | committed | aborted` state and is authoritative for the resulting generation/epoch.

1. The Controller durably records an intent, then calls broker `prepare_authority_transition(authorityTransitionId, expectedRevision, ...)`.
2. The broker idempotently prepares the transition, fences affected privileged delivery/control edges, and returns a prepare token plus proposed monotonic epochs/generation. While prepared, affected privileged mutations fail closed.
3. The Controller commits its local domain projection referencing that exact token/revision, then calls broker commit. The broker atomically activates the new binding/generation and emits a durable authority event; the Controller finally marks its projection reconciled.
4. Recovery queries broker state by `authorityTransitionId` and revision. Broker-committed/local-missing replays the broker event; local-committed/broker-prepared completes commit; intent-only retries prepare. Unknown or contradictory state quarantines the run read-only. Abort is allowed only when the broker proves no commit; compensation is a new transition and never decrements/reuses an epoch or generation.
5. A new Controller incarnation authenticates as the dedicated authority service, not with the stale Controller secret. Broker-monotonic `controllerGeneration` takeover and credential rotation use the same protocol before reconciliation or outbox mutation resumes.

Crash tests stop execution before/after every intent, prepare, local commit, broker commit, authority-event, projection, and credential-rotation boundary. Retries cannot double-increment an epoch, strand a private binding, resurrect an old Controller, or let broker/Controller disagree silently.

#### Participant enrollment

The Controller asks the broker to issue a one-time participant enrollment credential containing or referencing:

```text
bossRunId
participantId
role
communicationProfile
bindingEpoch
expiresAt
nonce
```

The broker stores only the credential digest and authoritative binding. On registration it consumes the one-time credential, stamps the session with broker-owned metadata, and returns a reconnect credential scoped to that participant and epoch. Replay, theft after consumption, role substitution, target-run substitution, and stale epoch all fail closed and are audited.

#### Already-connected Boss session and user authentication

`/boss` and `/boss resume` are accepted only as direct authenticated TUI user-command events, never as model text or a model-callable tool operation. The dedicated authority service issues a one-time, expiry-bound consent challenge tied to OS login identity, Pi/OpenCode session identity, `bossRunId`, requested operation, and `authorityTransitionId`; the trusted extension obtains explicit user confirmation and returns it over its non-exported broker-mediated capability. Challenges are single-use and not printed into model context. A replacement session requires a new confirmation; no reusable Boss credential is exposed to the model.

Binding then follows the cross-authority transition protocol: the broker fences delivery/control, increments `bossBindingEpoch`, stamps Boss-private metadata, updates allowed edges, commits the transition, and resumes delivery only after Controller projection reconciliation. Pause detaches decision authority but retains the Boss-private principal. Cancel revokes the run binding. Completion retains it until final proof and the exact user-testable path are presented, then releases it. A stale or unconfirmed session cannot send control, resume, or approve proof.

#### Communication profiles

Initial profiles:

```text
boss:       Manager, Adversary, Controller
manager:    Boss, Adversary, assigned Scouts/Workers, Controller
adversary:  Boss, Manager, Controller (typed review/proof + health; advisory text only on allowed edges)
scout:      Manager; Controller typed assignment accepted/rejected/checkpoint/submitted/blocker + health only
worker:     Manager; Controller typed assignment accepted/rejected/checkpoint/submitted/blocker + health only
council:    requesting Boss/Controller typed review result + health only
```

Worker↔Worker is denied. Worker/Scout arbitrary text to the Controller is denied; only authenticated, correlated assignment-control and health envelopes are allowed. Cross-run communication is denied. Boss-private↔unbound legacy local-public communication and discovery are denied in both directions. Ordinary legacy local-public↔ordinary legacy local-public remains compatible.

### 22.2 Protocol and broker migration

The first release keeps base Intercom protocol v3 and existing `remote-access-v1` policy semantics v2/hash for legacy clients. Boss-run vectors live in a **separate vector corpus** with a separate version/hash; Boss releases must not mutate `POLICY_VECTORS` or `POLICY_SEMANTICS_HASH`. It adds a separately negotiated feature:

```text
feature: boss-run-v1
version: 1
semanticsHash: <Core-generated hash>
controlEnvelopeVersion: 1
```

The base remote-access semantics are not globally replaced.

Rules:

- Old health/register requests continue to work against a dual-feature broker.
- A new ordinary client may work with an old broker without Boss features.
- A Boss participant must request and echo-verify `boss-run-v1`; an old broker rejects the scoped registration explicitly.
- Unknown Boss metadata is never ignored or downgraded to local-public.
- Adapter `spawnBrokerIfNeeded` becomes a system-service ensure/status client for the protected broker. It treats a broker as compatible only when base protocol, required feature subset, protected-service peer identity, signed provider digest, and owner uid match. User-side adapters cannot signal, replace, or directly spawn a `boss-run-v1` broker. An ordinary old client must not kill a compatible dual-feature broker.
- The feature-subset compatibility predicate ships in every installed adapter before any broker advertises or activates the Boss feature. The sole earlier carve-out is publication of dormant separate Boss constants/vectors in Core: they do not change the legacy hash or activate broker behavior. An old-hash ordinary client must not terminate a compatible dual-feature broker.
- Broker-first rollout is mandatory. Active broker drain/restart is explicit and audited.
- Mixed-version tests cover old-client/new-broker, new-ordinary-client/old-broker, Boss-client/old-broker rejection, remote credential continuity, and all installed adapter broker owners.

Broker ownership becomes explicit through a service-key-signed **broker identity record**. It contains owning provider package, provider digest/version, base protocol, feature set/hashes, protected service uid, owner uid, boot instance, PID, and broker generation. The coordinated adapter release installs root/service-owned provider artifacts; the system service selects one attested provider, while user adapters only ensure/query it. After adapter handlers and the dedicated Controller maintenance client are released, the protected service performs the one planned authenticated drain/restart; the old user-readable admin credential is revoked during migration, and peer identity plus generation/boot fencing prevents adapter or same-UID replacement races.

Core owns pure feature, authorization, credential-envelope, participant-state/event-schema, restricted-client operation, and golden-vector contracts. The active broker implementation owns the full Boss credential lifecycle—issuance, consumption, reconnect rotation, revocation, audit—and authoritative bindings in a Boss-specific registry/API namespace separate from remote-access-v1. Orc owns Boss domain state machines and typed payloads.

### 22.3 Manager↔Controller service and typed API

The Run Controller is a persistent per-run system service under the dedicated Controller OS identity, not an LLM and not tied to the Boss TUI lifetime. It owns the orchestration store, staffing authority, assignment dispatch, deadlines, participant lifecycle, and audit trail.

The purpose-built Pi Manager receives only a restricted `boss_manager` client extension with these typed tools:

```text
manager_get_status
manager_request_staff
manager_create_assignment
manager_cancel_assignment
manager_create_subscription
manager_list_subscriptions
manager_cancel_subscription
manager_submit_checkpoint
manager_report_blocker
manager_submit_proof
manager_request_adversary_review
manager_request_council
```

Worker and Scout runtimes receive a smaller `boss_participant` typed client limited to assignment accept/reject/checkpoint/submit, blocker, and health operations. Adversary and Council runtimes receive a read-only `boss_reviewer` typed client limited to review/proof submission, objection status, and health. Every operation preserves the originating `participantId` and `bindingEpoch`; a Manager text relay cannot advance assignment or review state.

`manager_request_council` is a Controller service request, not a direct Manager→Council communication edge. The Controller staffs the authorized Council and returns correlated `boss.council.*` results to the requester. Before the final Council release step, these schemas are reserved and the request deterministically returns `feature_not_enabled`; they are not part of the single-goal MVP execution surface.

Every request includes:

```text
bossRunId
managerParticipantId
bindingEpoch
requestId
idempotencyKey
operation
payload
```

The client authenticates through a broker-mediated, private role-scoped gateway to the dedicated authority service using a Manager-scoped credential; user-side processes have no direct authority-service socket path. The Manager runtime can access only its own credential through an isolated mount/file descriptor; controlled tools and all other participants cannot read it. No model process receives the Controller/admin credential or another participant's credential. The Controller validates role, epoch, budget, workspace, and state transition. Results are typed and idempotent.

Raw `intercom_send`, fallback text, or ordinary model conversation cannot create or satisfy an Assignment, StaffingIntent, Watchdog, Review, ProofPacket, or Decision. Unsupported or security-sensitive control fails delivery and is never injected into model-visible chat.

When the Boss TUI is offline, the Controller continues within accepted budgets. It may staff, supervise, pause failed assignments, and collect proof, but cannot approve completion, widen permissions/budgets, or resolve a material Adversary objection. Such decisions remain queued for Boss rebind.

### 22.4 Assignment and control envelopes

Core defines the generic versioned envelope. Orc defines Boss payload schemas.

```text
control.type
control.version
control.messageId
control.bossRunId
control.participantId
control.bindingEpoch
control.causationId?
control.replyTo?
control.idempotencyKey
control.payload
```

Boss v1 control types include:

```text
boss.assignment.created
boss.assignment.accepted
boss.assignment.checkpoint
boss.assignment.submitted
boss.assignment.rejected
boss.assignment.cancelled
boss.staffing.requested
boss.staffing.resolved
boss.review.requested
boss.review.submitted
boss.council.requested
boss.council.submitted
boss.proof.submitted
boss.worker.health
boss.worker.blocked
boss.worker.failed
boss.worker.notice
boss.worker.notice_delivery_failed
boss.decision.required
```

Only a correlated valid typed response can advance an assignment or cancel/rearm its watchdog. Text messages remain advisory conversation.

#### Boss context filtering

The Boss-visible context may contain direct Manager milestone summaries, direct Adversary objections/verdicts, Controller-generated status/decision/proof summaries, and artifacts explicitly requested by the Boss. Raw Worker/Scout chat, control envelopes, health chatter, command logs, retries, and low-level assignment traffic are stored outside Boss context and represented only by compact Controller/Manager summaries. Context-filter decisions are audited and tested; direct allowed Manager/Adversary edges are not suppressed.

### 22.5 Worker readiness, health, and proactive notification

Systemd `ActiveState=active` is not readiness.

All harnesses implement one canonical participant-state vocabulary:

```text
provisioning → registering → ready → working ↔ waiting
                    │          │         │       ↘ paused → ready/waiting
                    ├──────────┴────────→ blocked
                    ├───────────────────→ stalled
                    └───────────────────→ failed | lost | unreachable | stopped
```

Canonical states are exactly `provisioning | registering | ready | working | waiting | paused | stalled | blocked | failed | lost | unreachable | stopped` for both ordinary owned workers and Boss participants after WorkerStore v2 migration. `paused` is a persisted checkpointed park state that may resume under a new generation; if pause policy stops rather than parks the process, that participant generation becomes `stopped` and resume provisions a new generation. `stopped` is terminal for that participant generation after pause-stop, lease stop, completion, cancel, or teardown. `blocked` carries a reason and may recover; `stalled` is controller-derived liveness state; `failed`, `lost`, and `unreachable` are distinct failure/connectivity outcomes.

Legacy migration is explicit and audited:

```text
provisioning  → provisioning
running       → registering + requiresReadinessReconciliation
idle          → registering + legacyIdleHint; then waiting only after ready/no-active-turn proof
needs_attention → blocked(reason=legacy_needs_attention)
completed     → stopped(terminalOutcome=completed)
failed        → failed
stopped       → stopped
lost          → lost
stopping      → migration-pending/read-only; reconcile systemd to stopped|failed|lost,
                or unreachable(reason=legacy_stopping_unresolved) after the bounded settle window
```

The original legacy state/outcome is retained in migration audit metadata. Migration never infers `ready` or `working` from `running`, never treats a deactivating process as stopped before reconciliation, and never permits dispatch while migration is pending. The old `isLiveState` predicate is replaced: `failed | lost | stopped` are terminal for the current generation; all other canonical states are nonterminal, but process cleanup/lease decisions also require current systemd/cgroup observation rather than inferring process existence from semantic state. A restarted failed/lost/stopped worker always receives a new generation.

A worker becomes `ready` only after positive evidence of adapter startup, broker registration, binding attestation, capability/profile attestation, and assignment-control support. A live foreground terminal/tool operation keeps the participant `working`; an idle model session with a valid bounded external-wait lease is `waiting`, not `stalled`. An inactivity subscription trigger is a supervisor notice and does not itself rewrite canonical state unless the separate Controller liveness policy has enough evidence to transition to `stalled`. Pi, Codex, and Claude gain a bounded readiness surface equivalent to the existing OpenCode readiness gate.

Every adapter emits structured events for:

- registration ready/failure
- assignment accepted/rejected
- turn started/completed/failed
- permission/workspace/tool block
- session resume failure
- checkpoint/progress
- adapter crash/process exit
- final result

Authenticated adapter/launch-bridge turn settlement and Orc reconciliation both feed the durable lifecycle-notice outbox. Orc sends compact `boss.worker.*` events immediately to the Controller/Manager for settled work, failure, exit, stop, stall, and timeout; it does not wait for the normal response deadline when the outcome is already known. The vestigial `needs_attention` state is removed in Boss v1; `blocked`, `failed`, `lost`, and `unreachable` carry explicit reasons.

Events are durable and replayable:

```text
eventId
bossRunId
participantId
bindingEpoch
previousState
state
severity
failureCode
reason
suggestedRecovery
occurredAt
acknowledgedAt?
```

Boss/Council status shows participant state and last confirmed liveness age:

```text
provisioning | registering | ready | working | waiting | paused | stalled | blocked(reason) | failed(error) | lost | unreachable | stopped
```

A wrapper process without a viable model session is not reported as working.

### 22.6 Lifecycle and offline transition matrix

| Event | Boss binding | Controller | Participants | Assignments/watchdogs | Manager lifecycle notices |
|---|---|---|---|---|---|
| Pi `reload` | retained/revalidated | continues | continue | continue | pending outbox retained; bridge reattaches and deduplicates |
| Pi `quit` | detached; epoch fenced | continues | continue within budget | continue; approval blocked | notices persist without delivery until authenticated rebind |
| Pi `new` | detached from prior run | continues | continue | continue | prior-run notices are not delivered into the unrelated new session |
| Pi `resume` another session | prior binding detached | continues | continue | continue | prior-run notices remain pending for the bound Manager/Boss principal |
| Pi `fork` | fork is not Boss until explicit bind | continues | continue | continue | fork inherits no notice-delivery or acknowledgment authority |
| `/boss pause` | retained, no decisions | pauses dispatch | checkpoint then stop/park persistent workers | timers paused with recorded remaining duration | pause/stop notices persist; no stale-generation delivery |
| `/boss resume` | direct-user consent then authority transition | queries broker transition state and reconciles projection | resume/restart exact committed bindings | overdue work reconciled before dispatch | old claims fenced; pending notices delivered once before new dispatch |
| Manager replacement | unchanged | broker-authoritative prepared transition fences old Manager, then commits new epoch | Workers checkpoint; new Manager binds | explicitly reassigned; audit preserved | old claims fenced; only pending/unclaimed notices transfer; old epoch cannot receipt/acknowledge |
| Controller crash | unchanged | dedicated service restarts; queries every pending authority transition before mutation | checkpoint/wait if control unavailable | no unauthenticated progress transitions | durable outbox/claims replayed with transition/generation dedupe; ambiguous ingress remains blocked |
| Worker MaxRuntime/lease expiry | unchanged | decides restart/replace/stop | affected worker stops | marked lease-expired, never silently accepted | exact timeout/termination reason delivered automatically |
| Participant failure | unchanged | notified immediately | failed participant isolated | assignment paused, blocked, replaced, or queued for a Boss decision according to the configured failure-handling policy | failure notice delivered automatically; stale generation rejected |
| Completion | retained until user presentation | freezes run | participants checkpoint then stop | terminal and immutable | completion/final-proof notice delivered before presentation |
| Cancel | revoked | terminal cleanup | exact owned cgroups stopped | cancelled with audit | cancellation/stopped notices retained per policy |
| Explicit teardown | revoked | store retained or acknowledged deletion | stopped | immutable history | final notices/audit retained or acknowledged-deleted per policy |

The persistent cleanup timer reads Boss-run state. It does not apply ordinary manager-shutdown cleanup to active Boss participants. Unknown or unavailable Controller state fails safe: no destructive cleanup until lease/grace plus explicit reconciliation criteria are satisfied. Store deletion requires an authenticated Boss/user acknowledgment after final presentation and after the configured retention policy permits deletion; otherwise explicit teardown retains the store.

### 22.7 Purpose-built Pi Manager manifest

Minimum Pi SDK: `0.82.1`. The purpose-built Manager runner and its explicit Orc Manager bridge must declare and test a compatible Pi SDK floor `>= 0.82.1`.

Exact model tuple:

```text
harness: pi
model: codex/gpt-5.6-sol
effort: high
fallback: none
```

Manager-private root (contains only Manager-scoped material, never Controller/admin secrets):

```text
~/.pi/agent/intercom/boss-runs/<bossRunId>/manager/
```

Explicit resources only:

- Intercom worker/control client
- `boss_manager` typed client plus Orc lifecycle-notice receiver/renderer extension
- read/search tools
- controlled bash/test tools: explicit executable/subcommand allowlist, fixed workspace cwd, sanitized environment, no arbitrary interpreter/eval escape, network denied unless a task-specific grant exists, and sandbox mounts that make Controller sockets, credentials, private run roots, Git credentials, and unrelated worktrees unreadable even to the same Unix uid
- session persistence and compaction

The purpose-built controlled-tool runner is the authoritative Manager enforcement boundary, not PATH interception alone. It may reuse the existing guard allowlists/policy definitions, while `src/guard-bin/*` remains defense-in-depth for ordinary profiles. `clean-env-launcher.mjs` and sandbox PATH construction preserve guard precedence, and the Manager sandbox prevents direct absolute invocation from bypassing the runner or protected Git/credential mounts.

Excluded:

- full Orc extension and `agent_fleet`
- Pi subagents
- generic extension/skill/prompt/theme/context discovery
- unrelated MCPs
- hosting/cloud/desktop authority

The canonical Manager startup inventory contains exactly: Pi SDK version; harness/model/effort/fallback tuple; tool IDs and versions; extension IDs/versions/hashes; environment-variable allowlist digest; workspace/run/repository-lock identity; permission profile and effective sandbox; capability/feature digest. The runner hashes this canonical manifest, and the Controller verifies every field before readiness.

Workspace policy for MVP is enforced by the Run Controller's repository lock, workspace validator, and trusted Git integration API together with the `manager-restricted` Manager profile and `builder-restricted` Worker profile:

- one active write-capable Boss run per repository
- one isolated integration worktree per run
- exactly one source-writing Worker may be active across all run worktrees; the Manager may write only generated evidence/state
- Workers may use separate exclusive worktrees, but the Controller exposes a generation-fenced mutable mount/dispatch token to only the single active source writer; all other Worker worktree views are read-only or receive no source-writing assignment, and integration is serialized
- Manager may run integration/test commands and write generated evidence; source edits remain Worker work
- Git metadata and credentials remain protected; Controller/Boss performs intentional Git integration only through audited trusted operations

### 22.8 Staffing and cost limits

Default automatic limits per Boss run:

```text
Managers: 1
Adversaries: 1
Workers: 2 total, 1 active writer
Scouts: 2
Council runs: 1 at a time
```

Exact default profiles:

```text
Manager:    pi / codex/gpt-5.6-sol / high / manager-restricted
Adversary:  claude / claude-opus-5 / xhigh / review-readonly
Scout:      codex / gpt-5.6-sol / low / review-readonly (medium explicit escalation)
Worker:     codex / gpt-5.6-sol / medium / builder-restricted
Council systems advisor:     codex / gpt-5.6-sol / xhigh / review-readonly
Council critical advisor:    claude / claude-opus-5 / xhigh / review-readonly
Council alternative advisor: claude / claude-fable-5 / medium / review-readonly
```

No silent model, effort, harness, or permission fallback. Wider staffing, higher effort, longer runtime, or broader permissions requires a Boss decision. These Council tuples are for the independent advisory workflow; the separate formal-approval sequence is Opus → Fable → Sol under §22.17 and is not a per-run staffing default.

### 22.9 Codex and Claude permission corrections

#### Codex

No permissionProfile→native-sandbox mapping exists today: `src/workers.ts` applies permission-derived args only to Pi, `codex-safe` hardcodes workspace-write, and `codex-minimal` supplies no sandbox flag. Orc adds and owns this mapping:

```text
review-readonly    → --sandbox read-only
builder-restricted → --sandbox workspace-write, except a launch profile intentionally tighter remains tighter
codex-minimal + unspecified/review-readonly → explicit --sandbox read-only
trusted            → explicit trusted policy
```

The inner policy may never exceed the outer profile, and adding explicit mapping may never loosen a launch profile's effective behavior. In particular, `codex-minimal` acquires an explicit read-only sandbox instead of relying on the Codex bridge library fallback; it remains read-only unless the Boss explicitly authorizes a broader profile. Orc owns the initial mapping defect and the outer-Orc/inner-Codex regression. `agent-intercom-codex` owns protocol/control changes and effective-sandbox readiness reporting; adapter/upstream filesystem changes are required only if correct mapping still fails.

Regression proof covers startup, no tracked/untracked workspace mutation, private `CODEX_HOME`, nested agents, network/capability ceiling, and `.agents`/`.codex` behavior.

#### Claude

Orc and `agent-intercom-claude` co-own the correction. Orc removes unconditional `--dangerously-skip-permissions` injection from `src/runtime.ts` for hardened workers and supplies an explicit permission mode derived from the Orc profile. The adapter changes defaults away from `bypassPermissions`/`dangerouslySkipPermissions`, validates the supplied mode, supports defense-in-depth read-only operation, and ensures subagents inherit the same-or-tighter ceiling. Task/subagent capability cannot bypass the outer profile. Launch tests assert that no hardened Claude argv contains any permission-bypass flag.

### 22.10 Orc lifecycle-notice contract

The lifecycle-notice implementation is a generic `agent-intercom-orchestrator` facility for every owned `agent_fleet` worker and is reused by `/boss`. Existing Pi, Codex, Claude, and OpenCode lifecycle observation surfaces will be extended to emit authenticated, correlated settlement events to Orc; this Orc-facing settlement contract does not exist today. Delivery is adapter-neutral at the Orc authority and supports Pi Manager, OpenCode Manager, and headless CLI ownership explicitly. Pi uses the public extension API; OpenCode extends its existing fleet/active-session/injection/health surfaces. No Pi core patch and no return-on integration is required.

Canonical notice envelope:

```text
version: orc.lifecycle-notice.v1
noticeId
deliveryGroupId
deliveryGroupMembershipRevision
requestedDeliveryIntent?: wake | follow_up | status_only
sourceEventId
transitionId
transitionVersion
bossRunId?
workerId
workerIncarnationId
assignmentId?
turnId?
watchdogGeneration?
subscriptionId?
subscriptionTriggerGeneration?
causationId?
resultMessageId?
recipientSessionId?
recipientTargetSessionId?
recipientPrincipalId?
recipientBindingEpoch?
workerGeneration
kind
severity
observedState
reason
createdAt
deliveryAttemptedAt?
deliveryClaimId?
deliveryClaimGeneration?
deliveryClaimExpiresAt?
deliveryClaimState?: reserved | inserting | inserted | delivered | blocked | released
recipientContext: pi | opencode | headless_cli
deliveredAt?
deliveryMode?: lifecycle_message | correlated_result
deliveryReceiptId?
coalescedByResult?
acknowledgedAt?
```

Canonical delivery-group record:

```text
version: orc.delivery-group.v1
deliveryGroupId
equivalenceKey: recipientPrincipalId + recipientBindingEpoch + sourceAuthorityId + sourceEventId + bossRunId? + workerId + workerGeneration + transitionId + transitionVersion + assignmentId? + turnId? + watchdogGeneration?
subscriptionRegistryRevision
membershipRevision
membershipState: assembling | sealed
primaryNoticeId
memberNoticeIds[]
requestedIntents[]
effectiveDeliveryIntent: wake | follow_up | status_only
operativeActivationConsumedAt?
recipientTransferGeneration
supersedesDeliveryGroupId?
successorDeliveryGroupId?
authorityTransitionId?
state: pending | reserved | inserting | inserted | delivered | blocked | migrated
```

Producers:

- Controller assignment transitions, including typed `submit`, reject, checkpoint due, and stall
- newly extended authenticated adapter/launch-bridge readiness and `turn_settled` events, using stable source/turn event IDs for Pi, Codex, Claude, and OpenCode
- Orc reconciliation of systemd unit exit/failure, startup/readiness failure, explicit stop, idle checkpoint-grace expiry, lease expiry, and MaxRuntime

Identity and transaction boundaries:

- The logical uniqueness key is `(workerId, workerGeneration, transitionId, transitionVersion, kind)`, extended by `assignmentId`/`watchdogGeneration` or `subscriptionId`/`subscriptionTriggerGeneration` when applicable. `noticeId = H("orc-notice-v1", canonical(full logical key))`; result ingress first commits/ensures that deterministic notice in the appropriate source-authority transaction, then requests group assembly.
- The canonical delivery-equivalence key is `(recipientPrincipalId, recipientBindingEpoch, sourceAuthorityId, sourceEventId, bossRunId?, workerId, workerGeneration, transitionId, transitionVersion, assignmentId?, turnId?, watchdogGeneration?)`. `deliveryGroupId = H("orc-delivery-group-v1", canonical(equivalence key))`. `sourceAuthorityId` is a tagged canonical identity: `worker_store(workerStoreId, journalGeneration) | controller(bossRunId, controllerGeneration) | orc_scheduler(ownerUid, schedulerGeneration)`. It and `sourceEventId` identify the protected journal event that minted the transition. Subscription ID, trigger ID, notice kind, severity, and requested delivery mode are intentionally excluded; they are members/attributes of the same transition. Recipient, worker generation, assignment/turn/watchdog correlation, and transition version are included, so unrelated workers/transitions cannot collide.
- A subscription trigger for a built-in state/process/turn/assignment transition copies that exact source event's equivalence fields. For inactivity-only delivery, Orc mints `transitionId = H("orc-inactivity-edge-v1", workerId, workerGeneration, inactivityEpochId, inactivityMode, activityBasis, inactiveAfterMs, dueAt)`; only subscriptions with the same normalized target, inactive epoch, mode, basis, threshold, and due instant share the edge. Different thresholds or inactive epochs are distinct transitions.
- Adapter and reconciliation evidence for the same logical transition converge on that key. Semantically distinct transitions, such as `turn_settled` followed later by `process_exited`, retain distinct `transitionId`/kind pairs.
- Generic worker/systemd transition plus outbox notice commits in one Orc authority-journal/WorkerStore transaction. Boss assignment/watchdog transition plus outbox notice commits in one Controller-store transaction. The Orc group assembler then consumes that committed transition exactly once, snapshots `subscriptionRegistryRevision`, evaluates every subscription authorized and active at that revision, creates the built-in/member notices and trigger audit rows, and seals one immutable `membershipRevision`. A subscription committed after the snapshot does not replay the prior event. Crash replay reconstructs the same member set from the recorded revisions. No delivery reservation is legal while `membershipState != sealed`.
- A separate dedicated-authority-service-owned, fail-closed Orc `DeliveryClaimStore` is authoritative for reservation/insertion/receipt state with a unique sealed `deliveryGroupId` and primary/member notice IDs; `deliveredAt` in source notice stores is an idempotent projection. Cross-store projections replay from `sourceEventId`/`noticeId`/`deliveryGroupId`; there is no claimed cross-file atomic transaction.
- Each member records `requestedDeliveryIntent`. The sealed group computes a deterministic monotonic aggregate with total precedence `wake > follow_up > status_only`; built-in lifecycle notices default to `wake`. Processing order cannot downgrade the aggregate. `wake` starts a turn while idle and becomes a busy-session follow-up; `follow_up` queues behind an active turn; `status_only` creates only a receipted UI/CLI status entry. Result coalescing requires the same authenticated transition, assignment/turn correlation, worker generation, and current Manager binding. Worker or assignment identity alone cannot suppress a notice.

Delivery and receipt:

- Orc persists the notice `recipientContext` (`pi | opencode | headless_cli`), authenticated Intercom `recipientSessionId`, optional Pi/OpenCode UI `recipientTargetSessionId`, recipient principal, and binding epoch. Worker lifecycle notices default to the owning Manager; subscription-trigger notices target the authenticated subscriber, including a Boss Agent. One `NoticeRecipientIngress` interface defines claim reservation, target-ledger lookup, injection/attachment, receipt, replay, and acknowledgment for all contexts.
- The Orc delivery coordinator is the single pre-injection serialization authority. Both lifecycle reconciliation and authenticated correlated-result ingress call `reserve_delivery` before any recipient wake API. Reservation requires a sealed membership revision and carries its `effectiveDeliveryIntent`; a claim whose membership revision or aggregate intent does not match is stale and cannot invoke an ingress adapter. One durable CAS grants `deliveryClaimId`, mode, claim generation, expiry, recipient epoch, worker generation, membership revision, and exact correlation. Claim state advances `reserved → inserting → inserted → delivered`; target ambiguity becomes `blocked`, and only proved absence permits `released` plus a higher-generation reservation. A bridge without the winning current claim must not inject or queue anything.
- Pi claims call public `pi.sendMessage` only after reservation, using `followUp` while busy and `triggerTurn: true` while idle. OpenCode claims extend `opencode/fleet.ts`, `opencode/plugin.ts`, `opencode/health.ts`, its pending injection queue, active-session resolution, `session.promptAsync`, and message-ID dedupe to provide the equivalent current-session wake and durable insertion ledger. API invocation alone never sets `deliveredAt`.
- A winning bridge inserts `deliveryClaimId`, `deliveryGroupId`, sealed membership revision, effective intent, primary/member `noticeId`s, and transition IDs, persists a target-session ledger entry, and sends an authenticated insertion receipt. Only a receipt matching the active claim/current recipient binding sets `deliveredAt`, delivery mode, receipt ID, result ID when applicable, and coalescing state.
- Recovery queries the target ledger by claim ID before retry. Confirmed insertion commits the missing receipt. Absence is proved only after the ingress adapter establishes a target-drained barrier—no session entry, no adapter queue/in-flight invocation, and completion/drain of any Pi follow-up or OpenCode pending-prompt path that could still insert the old claim. Only then may a generation-incremented reissue occur. Unavailable/ambiguous target state remains blocked for operator/rebind reconciliation; expiry or an empty instantaneous scan alone never proves non-insertion. Stale claim generations, epochs, sessions, and worker generations fail closed.
- Pi/OpenCode inbound bridges recognize only authenticated typed result envelopes with exact transition/assignment/turn/incarnation correlation and divert them into the coordinator before the normal chat-injection path. Unrelated/advisory text remains ordinary chat and cannot coalesce a notice. A result-claim winner performs the one operative wake. A lifecycle winner causes any later exact typed result to be stored in the Controller result inbox and linked to the notice; it is available through the already-woken Manager's typed read and may be appended to display/session history only without triggering or queuing another turn. Thus a post-insertion CAS is not relied on to undo an already-started wake.
- Pi and OpenCode reconnect/rebind scan their durable ledgers before replay. Manager replacement fences all old claims and transfers only pending/unclaimed notices. Compact UI counts are allowed; raw logs remain outside model context. `acknowledgedAt` remains a later authenticated recipient-processing state.
- Headless CLI ownership has no interactive session to wake. Notices remain durable/non-delivered, are returned with pending counts and full correlated summaries on the next authenticated fleet command, and may transfer to a newly authenticated Pi/OpenCode Manager attachment through an epoch-fenced authority transition. CLI output acknowledgment is receipted separately; the system never records or claims an interactive wake that did not occur.
- A `status_only` receipt does not set `operativeActivationConsumedAt`. The sealed aggregate ensures a required activation is known before reservation; if recovery discovers a status entry but no operative insertion, the same group may still execute its one effective wake/follow-up. Once an operative insertion is receipted, recovered sealed members and late exact results attach to the same target ledger/group without another activation. New subscriptions created after the recorded registry snapshot never join or replay the old group.
- Delivery/claim failures record `boss.worker.notice_delivery_failed` and are retried by persistent Orc reconciliation. Crash tests cover group assembly/sealing, conflicting member intents in every processing order, reservation, API call, target insertion, ledger fsync, receipt, claim commit, late sealed-member/result attachment, rebind, and recovery boundaries and prove one durable notice plus at most one operative wake/follow-up.

#### Durable supervisor subscriptions

Orc owns a generic, durable event-subscription layer over the same WorkerStore/activity journal and notice delivery path. It is available to ordinary `agent_fleet` owners and reused by `/boss`; it is not a chat-polling loop and is not implemented as a return-on job.

Canonical subscription record:

```text
version: orc.lifecycle-subscription.v1
subscriptionId
subscriberPrincipalId
subscriberBindingEpoch
subscriberBindingGeneration
lastSubscriberAuthorityTransitionId?
bossRunId?
target: worker(workerId, workerGeneration) | role(bossRunId, role)
followReplacement: false | true
predicates: state_changed | state_in[] | failed | stopped | turn_settled | inactive_for
inactivityMode?: smart | raw
inactiveAfterMs?
activityBasis?: meaningful | liveness
cooldownMs
maxFires?
expiresAt?
delivery: wake | follow_up | status_only
state: armed | triggered | suspended | cancelled | expired
triggerGeneration
lastActivityAt?
dueAt?
lastSourceEventId?
createdAt
updatedAt
```

Canonical trigger record:

```text
triggerId
subscriptionId
triggerGeneration
targetWorkerId
targetWorkerGeneration
predicateEdge
sourceEventId
transitionId
subscriberBindingEpoch
subscriberBindingGeneration
deliveryGroupId
deliveryGroupMembershipRevision
noticeId?
satisfiedByNoticeId?
successorDeliveryGroupId?
recipientTransferGeneration
createdAt
acknowledgedAt?
```

APIs are typed `agent_fleet` actions (`subscribe`, `subscriptions`, `unsubscribe`) for ordinary owners and restricted `boss_manager` create/list/cancel subscription operations for Boss Managers. The Controller creates the default Boss→Manager subscription at run start. The caller may omit its own principal/session fields; Orc derives them from authenticated invocation context. `wake` uses the normal idle-trigger/busy-follow-up behavior, `follow_up` queues behind an active turn without interrupting it, and `status_only` records a receipted UI/CLI notification without starting a model turn. Defaults are exact-generation, `followReplacement: false`, smart meaningful inactivity, one notification per inactive epoch, and ordinary lifecycle-notice delivery. Role selectors and replacement following require Boss Controller authorization.

Subscription ACLs are supervisor edges, not arbitrary observation: ordinary Manager/owner→owned Worker; Boss→current Manager; Manager→assigned Worker/Scout; Controller→run participant. Worker→Worker, cross-run, unrelated target, hidden discovery, stale subscriber epoch, stale target generation, and self-escalating replacement-follow requests fail closed. Subscription visibility follows the same filtered discovery policy.

Authenticated activity records distinguish:

```text
meaningful activity: turn/tool/progress/checkpoint/assignment/state transition
liveness activity: authenticated process/session heartbeat or health confirmation
active operation lease: foreground terminal/tool invocation + invocation/PID/cgroup identity
external wait lease: waiting_external(sourceKind=process|timer|file|port|url|webhook|async_tool|other, sourceRefHash, processIdentity?, startedAt, renewBy, maxUntil, expectedWakeAt?)
```

`inactive_for` with `smart` mode does not fire while a current active-operation lease remains backed by the same live invocation/PID/cgroup, or while a bounded authenticated external-wait lease is unexpired and renewed. Those leases also defer only soft idle/checkpoint-grace cleanup to the bounded renewal/max time; they never extend hard worker lease, MaxRuntime, security, proof, or user-decision deadlines. Terminal process exit/failure, operation settle, lease cancel/fire/expiry, missing renewal, worker generation change, or contradictory systemd state ends suppression immediately. A long terminal command therefore reports active operation facts rather than false idle; a model-idle session waiting on a declared async watcher remains `waiting`, not `stalled`. `raw` mode intentionally ignores leases and measures the chosen activity basis directly.

Wait leases are tool-agnostic Orc control events. Every external-wait lease has mandatory `maxUntil ≤ min(now + maxExternalWaitLeaseMs, hard worker lease expiry, MaxRuntime)`; the default external-wait ceiling is two hours, renewal cannot move that bound, and a fresh lease beyond it requires resumed activity or explicit supervisor policy approval. Harness adapters automatically publish operation leases from their terminal/tool lifecycle. A worker or extension may publish `waiting_external`; return-on may benefit if it emits this generic event, but Orc never imports, probes, enumerates, or version-gates return-on and no return-on change is required. An undeclared async wait cannot silently extend supervision forever.

Each subscription trigger persists independently for audit/accounting. The group assembler evaluates the complete active subscription snapshot for the committed source transition, derives the canonical equivalence key, records every matching trigger/member, computes the precedence aggregate `wake > follow_up > status_only`, and seals membership before delivery. If the same source transition creates a built-in lifecycle notice for the same recipient, the trigger records `satisfiedByNoticeId`; matching subscriptions for that recipient become members of the same group. The injected summary includes all sealed reasons. Different recipients, worker generations, assignment/turn/watchdog correlations, inactivity predicate edges, and semantically distinct later transitions retain separate groups.

The inactivity scheduler persists `dueAt` and recomputes it transactionally on authenticated activity/lease changes. It mints the canonical inactivity transition for each normalized `(target worker/generation, inactivityEpochId, mode, activityBasis, inactiveAfterMs, dueAt)` edge, emits one `subscription_triggered` audit transition per matching `(subscriptionId, triggerGeneration)`, then routes the sealed deterministic group through `DeliveryClaimStore`. It rearms only after activity resumes or the predicate leaves the matched state; cooldown alone cannot rearm a continuously inactive target. Exact-worker subscriptions cancel/suspend on target replacement; authorized role subscriptions with `followReplacement: true` move through the broker/Controller target-replacement authority transition and start a new target generation without replaying the old edge.

Authenticated subscriber rebind is a separate broker-authoritative `authorityTransitionId` operation, not a local epoch rewrite. Prepare fences the old subscriber epoch and all affected subscription delivery; the broker verifies the same stable principal, direct-user consent where required, new session binding, and current supervision edge. The Controller/Orc projection transaction then reauthorizes each subscription against the new role/run/target, increments `subscriberBindingGeneration`, updates `subscriberBindingEpoch`, and records the transition ID. Unauthorized or ambiguous subscriptions become `suspended` and cannot trigger or deliver.

Pending delivery migration is exactly once and fail closed. Unclaimed/sealed pending groups receive a deterministic successor `deliveryGroupId` using the new recipient epoch, increment `recipientTransferGeneration`, record old↔new group links plus the authority transition ID, and atomically move their member/trigger projections; the old group becomes `migrated` and cannot reserve. Reserved/inserting/ambiguous old-epoch claims remain fenced until target-ledger recovery proves insertion or a target-drained barrier proves absence. A proved old-epoch insertion is committed as delivered and is not redelivered; proved absence releases the old claim and creates exactly one successor group. Already delivered/acknowledged groups are never replayed, but remain visible in authenticated history after rebind. Broker commit occurs only after these projections are durable; crash recovery queries the same transition and idempotently completes or aborts without double epoch/generation increments. This contract applies to the Controller-created default Boss→Manager subscription, so Boss resume neither leaves it permanently stale nor transfers it without fresh authorization.

Required examples:

```text
Manager → assigned Workers: failed/stopped/state_changed immediately; smart inactive_for 60s
Boss → current Manager role: failed/stopped immediately; smart inactive_for 10m; followReplacement true
```

A semantic completion notice does not claim the Boss goal is complete. It tells the Manager that a worker turn or assignment ended and includes the correlated assignment/result reference. Only the proof/approval flow can complete the Boss run.

### 22.11 External wake/loop tools are not dependencies

`pi-return-on` and `pi-ralph-wiggum` are **NO CHANGE**. `/boss` preflight, Manager startup, assignment supervision, timeout handling, lifecycle notification, pause/resume, and Manager replacement must all work when either package is absent. No Boss state is stored in return-on jobs or `.ralph`.

Optional use of either existing tool by a human or unrelated agent remains outside the Boss protocol and cannot advance, satisfy, cancel, or rearm a Controller assignment/watchdog. A tool-agnostic authenticated `waiting_external` lease may suppress a smart-inactivity subscription and defer soft idle/checkpoint-grace cleanup only within its mandatory bound; Orc does not query return-on state, and the lease cannot advance work or extend hard MaxRuntime/lease/security deadlines.

### 22.12 Fail-closed stores and migrations

Before adding Boss state, Orc `WorkerStore` and every adapter worker/access/inbound registry stop normalizing unknown versions or read errors to empty state. Boss enrollment uses a separate versioned registry/API namespace from remote-access-v1; migrations preserve existing remote credentials and prevent parent-session cleanup from cascading into unrelated Boss enrollment deletion.

Rules for all coordinated Worker, access, inbound, Controller, Boss, subscription, activity-lease, and delivery-claim stores:

- unknown newer schema: refuse mutation and preserve file
- malformed/corrupt state: quarantine/read-only recovery; never replace with empty
- atomic write + fsync + lock
- explicit migrations with fixtures
- optimistic version/CAS for Controller and scheduler races
- downgrade refusal when unsupported active features exist
- audit and outbox crash-point recovery

Legacy live workers remain ordinary workers and are not retroactively attached to a Boss run. WorkerStore v1→v2 renames legacy worker-incarnation `runId` to `workerIncarnationId` byte-for-byte, derives/persists a monotonic `workerGeneration`, leaves `bossRunId` absent, and applies the complete §22.5 legacy-state mapping with migration-pending dispatch denial and original-state audit retention; adapters reject any attempt to reinterpret the deprecated value as Boss authority. Legacy role/config aliases migrate additively. Remote-access-v1 credentials remain valid under preserved semantics v2; Boss credentials use the separate feature registry.

### 22.13 Proof classes and retention

Minimum proof by task type:

- UI: exact URL/path, preconditions, interaction steps, screenshots, observed state, persistence after reload where relevant
- API: exact request, sanitized headers/body, status/response, negative case, persistence/side-effect query
- CLI: exact command, environment, stdout/stderr, exit code, produced artifact
- Library: targeted tests plus a consumer-level invocation/example
- Infrastructure: live status/query, configuration revision, health check, failure/rollback evidence

Evidence is content-addressed, redacted before persistence, size/quota limited, and retained by configurable policy. Every artifact binds source/base/integration revision, profile/config versions, producer, and capture time. A material change invalidates affected proof and approvals. Final Boss presentation begins with the exact user-testable path before internal proof detail.

### 22.14 Repository ownership corrections

The authoritative repository map is:

- `agent-intercom-core` MUST: policy, credential/feature/control-envelope contracts, distinct `bossRunId`/`workerIncarnationId` identity schemas, protected broker endpoint/peer-identity/signed-identity/provider-attestation contracts, broker authority-transition records, restricted participant/reviewer schemas, notice-recipient claim/receipt contracts, lifecycle-subscription/predicate/activity-operation-wait-lease/trigger schemas, delivery-group equivalence/sealing/intent and subscriber-rebind migration records, and ACL vectors, canonical participant-state and complete legacy-migration schemas, vectors, exports/package surfaces
- `agent-intercom-pi` MUST: root/service-owned protected broker-provider artifact plus user-side service ensure client, public/authority endpoint split, bidirectional peer credentials, signed identity/boot pinning, legacy admin migration and substitution-safe restart; common broker-authoritative `authorityTransitionId` prepare/commit/abort/query API for bind/rebind/revoke/takeover plus run-scoped binding/ACL enforcement; Boss credential lifecycle/audit in a separate registry namespace; additive feature negotiation; broker identity/generation; compatibility/drain; existing intentional Pi control transport behavior; Pi `NoticeRecipientIngress` pre-injection claim, session-ledger receipt/recovery, non-triggering late-result attachment, and direct-user `/boss` consent provenance; readiness/health plus stable-ID turn, foreground-operation, and generic wait-lease events for Orc; filtered discovery; fail-closed worker/access/session-notice registries and migrations; include `broker/paths.ts`, `broker/spawn.ts`, `broker/ownership.ts`, `access-credential.ts`, `audit.ts`, manifests. Shared contracts converge through vectors without requiring byte-identical broker implementations.
- `agent-intercom-codex` MUST: root/service-owned protected broker-provider artifact and ensure client with public/authority peer authentication, signed identity, admin migration, and substitution-safe restart; protocol/control/readiness/team changes, stable-ID turn/foreground-operation/generic-wait-lease events for Orc, filtered discovery, restricted `boss_participant` and Codex-Council `boss_reviewer` clients, common broker-authoritative authority-transition prepare/commit/abort/query API, run-scoped binding/ACL enforcement, enrollment credential lifecycle/audit, identity/compatibility/drain/generation changes, and fail-closed durable registry readers/migrations; include `codex/coi.ts` launch parsing/snapshots plus broker `audit.ts`, `bridge-config.ts`, `app-server-client.ts`; preserve `coi.ts` omitted safe defaults and make explicit `--yolo` unavailable to hardened roles; readonly adapter changes conditional after Orc mapping, but effective sandbox reporting required
- `agent-intercom-claude` MUST: root/service-owned protected broker-provider artifact and ensure client with public/authority peer authentication, signed identity, admin migration, and substitution-safe restart; protocol/control/readiness/team, stable-ID turn/foreground-operation/generic-wait-lease events for Orc, filtered discovery, restricted `boss_reviewer`, safe permission defaults across `worker-config.ts`, `cli-runner.ts`, and human-facing `cci.ts`, common broker-authoritative authority-transition prepare/commit/abort/query API, run-scoped binding/ACL enforcement, enrollment credential lifecycle/audit, identity/compatibility/drain/generation changes, and fail-closed durable registry readers/migrations; include broker `audit.ts`
- `agent-intercom-opencode` MUST: root/service-owned protected broker-provider artifact and ensure client with public/authority peer authentication, signed identity, admin migration, and substitution-safe restart; protocol/readiness/team plus stable-ID turn/foreground-operation/generic-wait-lease events for Orc, filtered discovery and common Boss typed-control transport, common broker authority-transition API, run-scoped binding/ACL enforcement, enrollment credential lifecycle/audit, identity/compatibility/drain/generation changes, OpenCode `NoticeRecipientIngress` with pre-injection claims/session ledger/recovery/non-triggering late-result attachment, and fail-closed durable registry/inbound/health/notice readers/migrations; include broker `audit.ts`, `opencode/inbound-store.ts`, `opencode/fleet.ts`, `opencode/plugin.ts`, and `opencode/health.ts`; its file-spool `control.ts` is not the common broker control channel
- `agent-intercom-orchestrator` MUST: separate dedicated-UID broker/Controller service installer and protected runtime/state/socket provisioning, signed provider attestation and privileged legacy-admin migration, dedicated-UID Controller authority service, broker authority-transition intent/projection reconciler, direct-user consent, fail-closed WorkerStore v2 identity migration, Manager client/runner and canonical inventory verifier, participant/reviewer provisioning, repository lock/worktree allocator/trusted Git integration, authoritative controlled-tool enforcement coordinated with guard/clean-env surfaces, durable lifecycle-notice authority journal plus pre-injection delivery-claim coordinator, Pi/OpenCode/headless ingress/recovery, and generic subscription/activity-lease scheduler with typed `agent_fleet` subscribe/list/unsubscribe actions, removal/migration of stale return-on/Ralph supervision guidance/config, permissions, canonical health/lifecycle integration, proof/evidence, context filtering, `/boss`, and protected broker maintenance/drain coordinator; include `src/types.ts`, `src/config.ts`, `src/index.ts`, `src/workers.ts`, `src/updates.ts`, `src/sandbox-supervisor.mjs`, `src/clean-env-launcher.mjs`, `src/agent-fleet-cleanup.mjs`, `src/agent-intercom-access.mjs`, `src/opencode-peer-launcher.mjs`, `src/guard-bin/*`, manifests/locks/docs/system-service packaging, and add authority-transition/consent/wrapper/worktree/tool-policy/notice-claim/ingress modules
- `pi-return-on`: NO CHANGE; never required or probed by `/boss`
- `pi-extensions/pi-ralph-wiggum`: NO CHANGE; never loaded or probed by `/boss`
- Pi SDK/upstream MAY only after a public API audit finds a proven gap
- `pi-forks`, `pi-subagents`, `pi-spend`, desktop repos, and application repos: NO CHANGE for MVP

Orc does not npm-pin all adapters. It consumes explicit runtime feature attestations plus git-SHA/version metadata for coordinated diagnostics: Core feature hashes, Pi SDK minimum, adapter broker/control/lifecycle-event features, Orc notice-bridge capability, and Manager inventory. Return-on and Ralph are not inspected.

### 22.15 Corrected release order

1. After formal approval, accept/freeze this Section 22 contract and golden vectors.
2. Release Core additive contracts, including dormant separate Boss vectors/credential envelopes, protected broker provider/peer/endpoint/signed-identity schemas, and complete state-migration vectors. This does not activate or advertise `boss-run-v1` and does not change the legacy hash.
3. Release all four root/service-owned broker-provider artifacts and user-side ensure clients with the feature-subset predicate first. Only after every installed provider/client supports protected system-service operation may a broker advertise dual compatibility; then release signed provider/boot/generation identity, split public/authority sockets, bidirectional peer credentials, service-owned transition/admin state, broker-authoritative prepare/commit/abort/query, Boss/participant/Controller fencing, legacy admin migration, Boss credential lifecycle, run-scoped ACL/discovery, canonical identity/state/event schemas, protected drain, readiness/health, stable-ID settlement events, and substitution-safe restart recovery. Effective-sandbox reporting is deferred to step 5. Do not drain yet.
4. Release adapter Boss control transports, restricted `boss_participant`/`boss_reviewer` clients, and dormant Pi/OpenCode Manager-ingress hooks that cannot call a wake API without an Orc delivery claim; preserve ordinary legacy behavior.
5. Release Orc routing cleanup, canonical roles/instructions, removal plus additive migration of stale return-on/Ralph supervision guidance/config, `manager-restricted`, Codex sandbox mapping and Claude bypass removal together with adapter permission-default/`cci.ts` corrections and effective-sandbox reporting. Human-facing `cci.ts` becomes safe-by-default; bypass remains available only under an explicit trusted profile/user opt-in outside hardened roles.
6. Release fail-closed migrations/readers for Orc WorkerStore and every coordinated adapter worker/access/inbound/health/notice registry before creating Boss/Controller state, including WorkerStore v2 separation of `workerIncarnationId`, `workerGeneration`, and optional `bossRunId`; unknown/corrupt versions never normalize to empty and Boss enrollment uses a separate versioned registry namespace.
7. Install and attest the separate dedicated-UID broker and Controller services, root/service-owned provider bundle, protected runtime/state/socket directories, peer-credential policy, signed identity key, and privileged legacy-admin migration. Then release the Controller/Boss projection store, authority-transition reconciler, direct-user consent path, repository lock/worktree allocator/trusted Git integration, Manager API, participant/reviewer provisioning, authoritative controlled-tool runner, outbox/watchdog, lifecycle-notice journal plus pre-injection claim coordinator, Pi/OpenCode/headless ingress/recovery, and supervisor subscription/activity-lease scheduler, health/decision producers, full lifecycle foundation, diagnostics, inventory verifier, and protected maintenance/drain coordinator behind feature flags.
8. Use the released protected Controller maintenance coordinator for the one planned broker drain/restart and continuity proof; user-side adapters cannot invoke or race it.
9. Release the dedicated Pi Manager; its attestation and lifecycle-notice receiver are verified atomically before readiness.
10. Release `/boss` create/status/resume/pause/cancel/proof/approve/reject, proof/evidence/redaction/retention, Adversary objection/approval flow, Boss context filtering, shutdown/cleanup semantics, and final-presentation UI. Council message schemas remain reserved but execution returns `feature_not_enabled`.
11. Canary the single-goal `/boss` acceptance test.
12. Expand only after every pre-Council §22.16 acceptance item passes; enable Council execution last. At Council enablement, prove the one-Council-run ceiling under concurrent/replayed requests, including that excess requests require a Boss decision and cannot race past the limit, before production Council use is permitted.

### 22.16 Single-goal MVP acceptance test

A clean test repository and fake/real harness matrix must prove:

1. `/boss <goal>` accepts only a direct authenticated TUI user command, completes the one-time consent challenge, and promotes the current Pi session to Boss-private through a committed broker-authoritative transition whose Controller projection is reconciled before dispatch.
2. Ordinary local sessions cannot discover or message Boss participants, and vice versa.
3. Run Controller survives Boss TUI quit and resumes with epoch fencing.
4. Manager attests and the Controller verifies every canonical startup-inventory field: Pi SDK version; harness/model/effort/fallback tuple; tool IDs/versions; extension IDs/versions/hashes; environment allowlist digest; workspace/run/repository-lock identity; permission profile/effective sandbox; and capability/feature digest.
5. Manager requests a Worker through the typed Controller API; raw text cannot create an assignment.
6. Worker readiness is gated on broker/profile attestation, not process existence.
7. A deliberately broken worker produces immediate structured failure notification without waiting for the response deadline, followed by the configured policy outcome: pause, block, replace, or queue a Boss decision.
8. Codex review-readonly starts cleanly without workspace mutation; Codex `coi.ts` retains safe omitted defaults and hardened roles reject explicit `--yolo`/danger-full-access; Claude Adversary and subagents remain read-only. Captured argv for Codex `coi.ts`, Claude worker-daemon, CLI runner, and live `cci.ts` TUI paths proves no hardened process contains a permission/sandbox-bypass flag.
9. For Pi, Codex, Claude, and OpenCode workers, an authenticated task turn or typed assignment can settle without the model sending an Intercom message; stable source/turn IDs let Orc persist exactly one correlated lifecycle notice. Golden vectors prove the complete delivery-equivalence key distinguishes recipient epochs, workers/generations, assignments/turns/watchdogs, transition versions, and later transitions while coalescing built-in and subscription members from the same source transition. The group assembler snapshots the subscription registry, seals identical membership under replay/crash, and refuses reservation before sealing. Every permutation of built-in, `wake`, `follow_up`, and `status_only` members yields the same `wake > follow_up > status_only` aggregate; status-only cannot suppress or consume a required operative activation. For both Pi and OpenCode Managers, result-first, lifecycle-first, simultaneous pre-reservation, duplicate/late result, unrelated/wrong-assignment result, and stale epoch/generation/claim cases prove that only the exact authenticated current transition can win the delivery claim. No wake API is called before reservation; the winning claim records one terminal delivery mode, matching receipt/result IDs, one `deliveredAt`, one durable notice, and at most one operative wake/follow-up. A lifecycle winner links late results for typed retrieval/non-triggering display without a second wake.
10. Startup/readiness failure, process failure/exit, explicit stop, checkpoint due, stall, idle checkpoint-grace expiry, lease expiry, and MaxRuntime each produce the correct durable notice. Pi/OpenCode detach/rebind, Manager replacement, duplicate observations, and crashes at every reservation/API-call/insertion/ledger/receipt boundary recover by target-ledger query with no lost or duplicate interactive delivery; ambiguous state stays blocked. Headless CLI ownership durably returns pending notices on the next authenticated command or transfers them on authenticated interactive attach without claiming a wake. `deliveredAt` requires an authenticated current-binding insertion/CLI receipt for the recorded claim; `acknowledgedAt` remains later and distinct. The complete test passes with both `pi-return-on` and Ralph absent.
11. Manager and Adversary produce revision-bound proof; fabricated/stale evidence is rejected.
12. Boss approves only the matching proof revision and presents the exact user-testable path first.
13. Every lifecycle-matrix row is tested: reload, quit/offline authority ceiling, new, resume-another, fork non-inheritance, pause/resume, Manager replacement, Controller crash/reconciliation, lease expiry, participant failure, completion/presentation/release, cancel, and explicit teardown. While Boss is offline the Controller cannot approve, widen authority/budget, or resolve a material objection.
14. Unknown/corrupt/newer store schemas fail closed without losing worker or run state. WorkerStore v1→v2 exercises every §22.5 legacy state mapping, preserves original/outcome audit metadata, never infers ready/working, denies dispatch while `stopping` reconciliation is pending, and converges it only to the specified terminal/unreachable outcomes. Terminal-generation classification and cleanup use direct systemd/cgroup evidence; restarting a terminal generation cannot reuse it.
15. Cleanup stops only exact owned resources and applies the configured audit/proof retention policy; acknowledged deletion is tested only after final presentation and explicit authenticated authorization.
16. The four protected broker-provider matrix proves semantically equivalent broker-authoritative `authorityTransitionId` prepare/commit/abort/query recovery for bind/rebind/revoke, Controller takeover, credential rotation and Manager replacement; root/service-owned provider attestation, signed identity/boot pinning, public/authority endpoint split, bidirectional peer credentials, legacy admin migration, same-UID signal/socket/provider substitution denial, protected restart recovery, ordinary-only legacy-proxy forwarding with Boss/admin stripping and old/new ordinary continuity, enrollment/ACL/control/readiness/compatibility/drain/generation behavior for Pi, Codex, Claude, and OpenCode; implementations need not be byte-identical.
17. Worker↔Worker send/ask/reply/control/discovery is denied within a run while each Worker can reach only its Manager and correlated Controller control edge.
18. Raw Worker/Scout low-level traffic never appears in Boss context. Allowed Boss-visible content is limited to Manager milestone summaries, Adversary objections/verdicts, Controller status/decision/proof summaries, and artifacts the Boss explicitly requests.
19. Every proof class meets §22.13 minimums; evidence is content-addressed, secret-redacted before persistence, quota-limited, revision-bound, and presented exact-path-first.
20. A second write-capable Boss run for the same repository is refused/paused; only one source-writing Worker can mutate any run worktree; integration uses the isolated run worktree and only audited trusted Git operations.
21. Process isolation is proven: broker authority state and Controller/admin secrets exist only in separate dedicated-UID service boundaries. Manager, controlled tools, Worker/Scout/Adversary/Council, the Boss Agent, and ordinary same-UID local-public model sessions may reach only the broker `public.sock` data plane; they cannot read/use `authority.sock`, service state/capabilities, `/proc`/FD/env/argv secrets, signal or replace the broker, bind its protected path, forge its signed identity, access other-participant credentials, Git credentials, or another run/worktree. `/boss` start/resume requires a direct authenticated user-command event and single-use consent challenge; model text/tool calls and replay are denied.
22. Staffing ceilings are enforced under concurrent/replayed requests: exactly one Manager and Adversary, at most two Workers with one active source writer, and two Scouts; excess requests require a Boss decision and cannot race past limits. During the single-goal MVP, `manager_request_council` deterministically returns `feature_not_enabled`; the one-Council-run ceiling is proven separately at the Council enablement step.
23. A queued `boss.decision.required` survives Boss detachment and is presented immediately on authenticated rebind without being auto-resolved.
24. Manager controlled tools enforce the complete §22.7 policy: only allowlisted executable/subcommand pairs, fixed workspace cwd, sanitized environment, no arbitrary interpreter/eval escape, default-deny network except audited task-scoped grants, and sandbox mounts protecting Controller/run/Git/other-worktree secrets against the same uid. Clean-environment PATH reconstruction preserves guard precedence, and direct absolute executable paths cannot bypass the authoritative runner or Git/credential protection.
25. Legacy supervision config containing `recommendRalphForSubstantialWork` or `recommendReturnOnAfterSpawn` migrates with an explicit diagnostic and without losing unrelated settings; ordinary and hardened worker instruction/status snapshots contain no Ralph/return-on recommendation and no claim that Intercom delivery cannot wake the Manager.
26. WorkerStore v1→v2 preserves every legacy incarnation ID as `workerIncarnationId`, assigns a monotonic `workerGeneration`, leaves ordinary workers' `bossRunId` absent, and maps explicit environment/health/runtime/adapter/systemd/notice/Controller fields without ever treating deprecated `AGENT_INTERCOM_RUN_ID` as Boss authority.
27. Crashes before/after every authority intent, broker prepare, Controller projection commit, broker commit, authority event, takeover, credential rotation, and Manager replacement converge through idempotent query/reconciliation. Epochs/generations never double-increment or regress; prepared ambiguity fails closed; stale Controller/Manager credentials and projections cannot authorize.
28. Generic `agent_fleet subscribe|subscriptions|unsubscribe` persists across restart/detach. ACL tests allow ordinary owner→owned Worker, Manager→assigned Worker/Scout, Boss→current Manager, and Controller→participant; deny Worker→Worker, cross-run, hidden/unrelated targets, stale subscriber epoch, and unauthorized replacement following. State/fail/stop triggers persist once per deterministic edge. Matching built-in/subscription members for the same canonical recipient/source-authority/source-event/worker-generation/transition/assignment-turn-watchdog key share one sealed `deliveryGroupId`; unrelated workers/transitions and distinct inactivity thresholds do not. Conflicting delivery modes are order-independent and non-downgrading, producing at most one operative activation. Boss detach/resume and ordinary authenticated subscriber rebind test prepare/project/commit crashes, supervision-edge reauthorization, subscriber binding-generation increment, deterministic successor group rekey, unclaimed transfer, inserted-no-replay, ambiguous-blocked-until-drained, unauthorized suspension, and exactly-once default Boss→Manager subscription continuity.
29. Smart inactivity subscriptions implement the concrete examples: Manager receives a Worker alert after 60 seconds with no meaningful activity, and Boss receives a Manager alert after 10 minutes, unless a current foreground terminal/tool operation or renewed `waiting_external` lease with mandatory `maxUntil ≤ min(two-hour configured ceiling, hard lease expiry, MaxRuntime)` is valid. Identical normalized inactivity predicates in one inactive epoch share the canonical transition; different thresholds/due instants do not. Process/tool failure, settle, lease fire/cancel/expiry/missing renewal, or target-generation change ends suppression and restores soft idle cleanup. Valid leases may defer soft idle/checkpoint grace only to their bound; hard lease/MaxRuntime/security/decision deadlines remain unchanged. Raw mode intentionally ignores leases. Inactivity triggers once per epoch, rearms only after authenticated activity, and survives authorized Manager replacement without duplicate wake. The suite passes with return-on absent; if any async extension voluntarily emits the generic wait lease, it is honored without Orc loading/querying that extension.

### 22.17 Approval protocol

Approval is revision-bound:

1. Fable and Sol findings produced Revision 2.
2. Opus 5 `xhigh` rejected Revision 2 with A1–A9. Revision 3 closed all nine, but Opus found residual A10–A13 commissioning/consistency blockers.
3. Revisions 4–9 closed A10–A35 and prior advisories. Revision 10 closed A36 and received Opus, Fable, and Sol approval for hash `469137606ecc4cc19fba993509bf3a597db770cbdbcd535d292a04b48c5f29b2`.
4. That Revision 10 approval is obsolete: the user rejected its unrequested return-on/Ralph scope. Revision 11 removed those dependencies and replaced them with Orc-owned lifecycle notices; a focused scope audit passed, but formal Opus review found A37–A38 in Orc's own guidance/config and guard/launcher commissioning.
5. Revision 12 closed A37–A38 without changing the frozen scope boundary and received Opus/Fable approval. Sol rejected that hash with A39–A43: missing non-Pi Manager delivery, post-insertion wake arbitration, cross-authority transition recovery, same-UID admin isolation, and ambiguous Boss-run/worker-incarnation identity.
6. Revision 13 closed A39, A40, and A43 and the Controller/direct-user portions of A41/A42. Opus rejected it with B1 (same-UID broker remained the authority root without endpoint/peer/substitution protection) and B2 (incomplete legacy WorkerState migration).
7. Revision 14 closed B1–B2 with protected broker/Controller service boundaries and a complete state migration. Its Opus review was stopped without verdict when the user added durable coworker supervision subscriptions.
8. Revision 15 added ACL-scoped state/inactivity subscriptions with foreground-operation and generic external-wait lease awareness and received Opus approval. Before Fable, four non-blocking Opus advisories were accepted for closure.
9. Revision 16 aligned soft-idle lease wording, added same-recipient built-in/subscription delivery-group coalescing, named Core subscription ownership, and required a bounded external-wait `maxUntil`. Opus and Fable approved its unchanged hash; Sol rejected it because group equivalence/intent arbitration and subscriber-epoch rebind migration were incomplete.
10. Revision 17 defines the collision-resistant canonical group key, subscription-snapshot membership sealing, normalized inactivity edges, deterministic `wake > follow_up > status_only` arbitration, and broker-authoritative exactly-once subscriber-rebind group migration. It returns to Opus.
11. Fable reviews only an Opus-approved revision.
12. Any material Fable amendment returns the new revision to Opus.
13. Opus and Fable must approve the same SHA-256 file hash.
14. Sol `xhigh` then performs the final audit of that exact hash.
15. Any Sol-required material amendment restarts the Opus↔Fable cycle before Sol re-audit.

# Fresh Unified Maker v8 Market Release Plan

## Required work

1. Freeze the typed custody and settlement design against current source,
   manifests, tests, probes, and exact size gates.
2. Add the minimal MakerAdminCap custody hook in Core and prove why no
   companion-only implementation can receive a key-only Core object.
3. Add Output bundle and Physical asset no-ability custody tickets plus exact
   object-owned receive/release paths.
4. Replace the Market foundation-only quote surface with complete typed
   Maker/Soul/Physical listing, escrow, purchase, cancel, recover, settlement,
   state counters, and events while preserving activation zero state.
5. Add unit and multi-transaction object-receiving tests, negative tests, and
   external adversarial compile/runtime probes.
6. Run the seven-package warnings-as-errors tests, seven adversarial runners,
   force-disassembly builds, exact package-size gates, and semantic lock/ABI
   checks. Record commands and results in the final handoff.
7. Run a fresh independent P0/P1 audit. Verify every finding before applying a
   minimal sufficient fix, then repeat the complete regression until no P0/P1
   remains.
8. Update the unified v8 protocol documentation, create one clean commit,
   generate the bounded-phase handoff, and update `docs/codex/CURRENT.md`.

## Ownership and concurrency

- Primary implementation owner: root agent in the durable integration
  worktree.
- Architecture and verification-map agents: read-only.
- Independent audit agents: read-only, fresh context, and no source edits.
- Any concurrent writer must use a separate worktree and a disjoint path set;
  integration remains deliberate in the durable worktree.

## Stop conditions

- Complete only when every Spec acceptance item passes.
- Stop and record a blocker after two consecutive audit/fix rounds with no
  substantive progress or after five unsuccessful rounds.
- Do not start compiler/recovery/web or deployment work inside this phase.

## Completed verification

- Typed Maker control, Soul bundle, Base Physical, and Pack Physical
  listing/custody/purchase/settlement scenarios pass with exact split and
  holder/epoch assertions. Seller cancellation and lifecycle/protocol recovery
  paths preserve custody state.
- Seven warnings-as-errors suites pass: Core 70, Seal 28, Runtime 30, Output
  43, Physical 63, Market 15, Release 14 (263 total).
- All seven companion/adversarial runners pass. Output has 8 and Physical 15
  independent negative Market probes; Market has 8 exact-diagnostic probes.
- Seven force-disassembly size gates pass: Core 63,918/64,000; Seal 18,814;
  Runtime 52,431; Output 36,955; Physical 37,924; Market 26,069; Release 7,396
  bytes. Core retains 82 bytes under its unchanged self-set target.
- Two fresh read-only audits independently report No P0/P1. The healthy
  PAUSED Maker path intentionally permits seller cancel / buyer purchase but
  not third-party recovery, avoiding permissionless listing grief; the Spec
  and README now state that lane distinction explicitly.

# Fresh Unified Maker v8 Market Release Spec

## Bounded objective

Complete the fresh-v8-only fixed-price Market path for Maker control,
Canonical Soul bundles, and Physical assets. The phase owns typed listing,
real custody, exact-payment escrow, purchase, seller cancellation, recovery,
and settlement. It ends only with the full seven-package verification matrix,
an independent P0/P1 audit with no open finding, a clean commit, and a durable
handoff.

## Scope

- `animacraft_v8_market`: typed Maker/Soul/Physical listings, atomic payment
  escrow, settlement, lifecycle-independent exit paths, counters, events,
  quotes, and replay protection.
- `animacraft_v8_output`: real object-owned custody and private receive/release
  hooks for the exact CompleteOutput + CompleteReceipt + CanonicalSoul bundle.
- `animacraft_v8_physical`: real object-owned custody and private
  receive/release hooks for one exact transferable PhysicalAsset.
- `animacraft_v8_core`: only the smallest unavoidable MakerAdminCap
  object-owned custody/receive/rotation hook. Core cannot be bypassed because
  MakerAdminCap is `key`-only and its defining module alone can receive it.
- Manifests, locks, package probes, size gates, and protocol documentation
  directly required by those changes.

## Non-goals

- No v4-v7 compatibility, migration, fallback, dual read, or legacy ABI.
- No compiler, recovery controller, web cutover, GitHub, Vercel, signing,
  broadcast, or Mainnet work.
- No caller-authored package identity, object identity, content hash, or
  boolean that substitutes for a typed object/capability.
- No optional or partially activated Market capability.

## Protocol invariants

1. Every listing is a concrete typed object owned by the bound Market package.
   The actual key-only asset is transferred to the listing object's address;
   a pure ID or hash is never custody authority.
2. Output and Physical construct no-copy/no-drop/no-store custody tickets from
   the real assets and exact live registry records. Market must consume those
   tickets in the listing transaction.
3. Only the asset-defining module may receive a key-only child back from a
   listing. Its release hook rechecks the exact Market call cap, Market
   original/callable TypeOrigins, catalog, listing parent, object IDs, Root ID,
   Maker version, Root content, holder, ownership/control epoch, and immutable
   asset commitments.
4. Maker custody consumes the current exact MakerAdminCap into the listing.
   A purchase rotates control once; cancel/recover returns authority without a
   sale. Maker listing requires PAUSED lifecycle and an empty exact
   MakerTreasury so control escrow cannot capture seller revenue or accrue new
   revenue while listed.
5. Soul custody is one indivisible CompleteOutput + CompleteReceipt +
   CanonicalSoul bundle. Sale changes all live holder records and increments
   the Soul ownership epoch exactly once. CompleteOutput and CompleteReceipt
   each retain immutable `original_holder`; their content commitments bind
   that provenance field rather than mutable current holder. Immutable
   render/content/seal commitments therefore remain transfer-stable, while
   the holder/epoch Soul ownership commitment is recomputed from exact
   on-chain fields.
6. Physical custody requires `transferable == true`, exact current holder and
   ownership epoch. Sale increments its ownership epoch exactly once while
   preserving original provenance. Base and Pack source identities remain
   distinct and exact.
7. New Soul/Physical listings and purchases require an ACTIVE exact Root and
   current protocol snapshot. Seller cancel is always available. Their
   recovery is explicitly available without protocol-enabled or ACTIVE gating
   when the source is PAUSED/ARCHIVED, so lifecycle cannot trap an asset.
   Maker control listings are structurally PAUSED: the stored seller can always
   cancel, while permissionless recovery is limited to ARCHIVED or disabled /
   drifted protocol state. Allowing third-party recovery for every healthy
   PAUSED Maker listing would make all legitimate control sales griefable.
8. Every purchase requires one Coin whose value equals the listing price.
   Payment enters the exact MarketTreasury escrow balance before any split and
   leaves it at zero in the same transaction. Abort rolls back both custody
   and payment.
9. Settlement uses `u128` intermediate arithmetic. Every non-zero BPS share
   that rounds to zero aborts; total shares must be strictly below gross; the
   seller receives the exact residual:
   - Maker: Maker market fee -> ProtocolTreasury; Maker resale royalty ->
     immutable Root creator; residual -> seller.
   - Soul: Soul market fee -> ProtocolTreasury; Soul creator royalty -> Root
     creator; Maker source royalty -> exact MakerTreasury; residual -> seller.
   - Physical: Soul market fee -> ProtocolTreasury; Soul creator royalty ->
     Root creator; Maker source royalty -> exact MakerTreasury for a base
     source or exact PackTreasury for a Pack source; residual -> seller.
10. Listing status plus object-owned one-use children and exact epoch checks
    make purchase/cancel/recover replay fail closed. Wrong listing, wrong
    registry/treasury, cross-Root, cross-version/content, stale epoch, wrong
    payment, forged TypeOrigin, and unavailable call-cap paths must abort.
11. The sealed Market activation readiness proof remains the existing exact
    zero state. No listing or escrow may exist before activation.
12. Core production bytecode starts at 63,809/64,000. Core growth is limited
    to the unavoidable key-only MakerAdminCap custody hook, and the 64,000 B
    gate cannot be raised. Zero-call read accessors over fields already
    available in the object BCS may be removed in fresh v8 to make that hook
    fit without compatibility residue. All other behavior belongs in
    Market/Output/Physical. Every package must remain at least 10,000 bytes
    below Sui's 102,400-byte limit.

## Acceptance

- Typed positive paths pass for Maker, Soul, base Physical, and Pack Physical
  listing -> custody -> purchase -> exact settlement.
- Typed seller cancellation returns every PAUSED Maker authority and every
  listed asset. Soul/Physical PAUSED/ARCHIVED recovery and Maker/asset
  ARCHIVED or protocol-disabled recovery return custody to the stored seller;
  aborted purchases preserve buyer payment and listing custody.
- Adversarial tests cover TypeOrigin/call-cap/root/version/content/epoch,
  payment, cross-listing/cross-treasury, replay, generic transfer/store, and
  caller-supplied-authority bypasses.
- All seven warnings-as-errors Move test suites pass.
- All seven companion/adversarial runners pass, including new Market custody
  probes.
- All seven force-disassembly builds and exact `MovePackage::size()` gates
  pass; Core delta and final headroom are recorded.
- An independent read-only P0/P1 audit reports no open P0/P1 after fixes and a
  final full regression.
- `git diff --check` passes, the integration worktree is clean after one
  intentional commit, and the parent project CURRENT pointer plus generated
  handoff identify that exact commit and the next bounded release phase.

## Rollback point

- Worktree: `/Users/naoer/Documents/Claude/Projects/soulidity/tmp/animacraft-unified-v8-resume`
- Branch: `codex/unified-maker-v8-resume`
- Base: `d62bcffa92eca065dad1bee534c5019c0bf8507f`

# Animacraft v8 Move package

This is a fresh Sui package. It imports only the pinned Sui framework and has
no dependency, migration entry point, or runtime read against Animacraft
v4/v5/v6/v7.

## Core publication contract

- `protocol_config_v8` creates the one v8 protocol config and admin capability
  in `init`. Native Sui Circle USDC is the production payment TypeName. The
  generic protocol treasury can be initialized once, then governance may
  enable or pause new activity.
- `maker_v8::MakerRootV8<PaymentCoin>`, `MakerAdminCapV8`, and
  `MakerTreasuryV8<PaymentCoin>` are the sole Maker authority/economics tuple.
- The package publication orchestrator calls `maker_v8::new_maker_v8`, creates
  all required empty v8 registries in the same transaction, then shares the
  DRAFT Root and treasuries and transfers the non-generic-transferable Cap.
- Track, Part, Item, Style, Smart Color and Rule rows are dynamic fields on the
  shared DRAFT Root. Appends require the exact Cap, exact global sequence,
  category range, unique key and valid parent row.
- Each append advances both a category commitment and the aggregate
  commitment as SHA-256 of BCS `RollingCommitmentInputV8`. Initial values use
  the `animacraft-v8/empty-registry` domain; append values use
  `animacraft-v8/append-row`. Public helpers expose both operations.
- Only the package finalizer can call `activate_checked_v8`; it verifies the
  protocol snapshot, USDC TypeName, every count/sequence/commitment and every
  exact companion binding before the sole `MakerV8Activated` emission.
- FREE Maker access creates a real zero-payment `MakerPassV8`. PAID access
  requires the exact coin and splits the immutable protocol fee into the
  canonical protocol and Maker treasuries.

`DRAFT`, `ACTIVE`, `PAUSED`, and terminal `ARCHIVED` are encoded as `0..3`.
Required capabilities are Composition, Pack, Complete and Seal; Physical is an
optional v8 bit whose binding becomes mandatory when declared.

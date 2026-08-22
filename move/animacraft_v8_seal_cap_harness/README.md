# Base registry seal style-cap measurement

This package is a **test-only, localnet-only** harness. It is not a production
dependency, is not part of the seven-package release, and must never be
published to Mainnet.

## Result

On Sui CLI `1.76.1-homebrew`, localnet protocol version `130` reports:

```text
object_runtime_max_num_cached_objects = 1000
object_runtime_max_num_store_entries  = 1000
```

For the current `seal_base_definition_registry_v8` implementation, let:

- `S` be the observed style count.
- `R` be the number of distinct `(color_channel_key, default_swatch_key)`
  pairs referenced by those styles.
- `C` be the declared color-row count.

The seal transaction needs exactly this many dynamic child objects in the
ObjectRuntime cache:

```text
2*S + R
```

The two per-style children are the `StyleIndexKeyV8 -> StyleKeyV8` dynamic
field and the `StyleKeyV8 -> StyleRowV8` dynamic field. Each distinct referenced
color pair adds one `ColorKeyV8 -> ColorRowV8` child through `df::exists`.
The registry, Root, and AdminCap are top-level inputs and are not child-cache
entries. Key values and the registry UID are not separate child objects.

Therefore the row-aware safe condition for every measured Sui 1.76.1
transaction is:

```text
2*S + R <= 1000
```

The two borrowed style children also occupy `2*S` ObjectRuntime store entries.
Both protocol limits are 1000 in this measurement, so the cache inequality
implies the store inequality. In a future protocol version, check both
`2*S <= object_runtime_max_num_store_entries` and
`2*S+R <= object_runtime_max_num_cached_objects` independently.

Because `R <= min(S, C)`, a validator that has only counts can use the more
conservative sufficient condition:

```text
2*S + min(S, C) <= 1000
```

A style-only cap of `S <= 333` is safe for every legal color-reference shape,
but rejects valid colorless documents. A row-aware validator should instead
enforce `S <= 500` and `2*S + R <= 1000` after validating the references.

Consequences:

| Shape | Last proven pass | First proven failure |
| --- | ---: | ---: |
| One distinct color per style (`R=S`) | `S=333`, cache `999` | `S=334`, cache demand `1002` |
| No color references (`R=0`) | `S=500`, cache `1000` | `S=501`, cache demand `1002` |

The Core constant `MAX_STYLES=10_000` is not sealable in one transaction under
this protocol configuration: even a colorless document needs at least 20,000
cached children. Gas budget increases cannot lift the ObjectRuntime hard limit.

## Exact baseline and production-byte proof

The measurement branch started from clean commit:

```text
4333c4b2a6d9d3a544dc29c394a12e8b7db1012b
```

The Move dependency is pinned to Sui revision:

```text
73dd2c2ba6f9fdb21d7ffde2b50a3f2f0ac39bc1
```

At that revision, `crates/sui-protocol-config/src/lib.rs:1407-1416` documents
that the ObjectRuntime limits affect dynamic fields and are enforced during
execution. Lines `2988-2991` set both user-transaction limits to `1000`.
`sui-execution/latest/sui-move-natives/src/object_runtime/object_store.rs:245-284`
checks the cached-object map and returns `MEMORY_LIMIT_EXCEEDED` after the hard
limit. Its `object_exists` path at lines `480-492` uses the same cache, so the
color `df::exists` calls count as child lookups.

The production Core package was built normally and remained:

```text
MovePackage::size       63,918 bytes
64,000-byte headroom        82 bytes
base_registry_v8.mv      9,412 bytes
base_registry_v8.mv SHA-256
89ecbd9e3640ab218f92094c516d05d7efdacac4a12c56630759354af8d1bbc7
```

The full production package hit a localnet publish-time VM verification error,
so the metered test published a localnet-only slim package containing the same
seven module names, test fixture stubs for the six non-target modules, and an
unchanged copy of the production `base_registry_v8.move`. The normally built
production `base_registry_v8.mv` and the localnet fixture module had the exact
same 9,412 bytes and SHA-256 above; `cmp` returned `0`.

Localnet-only publication evidence:

```text
package  0x32da689aca9cc39e2a9bdafb17ff10f0e607c8cb3139c25e701dc9402c406858
publish  5GN7KgpyvirpEEJtMXQykyGgi73EEA2Q8wiHZ8EQ5mjb
```

## Metered localnet transactions

Every seal below was its own transaction, after all fixture creation and row
appends had succeeded in earlier transactions. All seal calls used a
`100000000000` MIST gas budget. The isolated 333/334 calls each returned in
about 0.6 seconds, and all four completed inside a 30-second command window;
none timed out.

| `S/C/R` | Cache demand | Seal digest | Status | Computation cost |
| --- | ---: | --- | --- | ---: |
| `333/333/333` | `999` | `GNu1LQvpt4UjruQiqU5uE3toNgCF7mmgw4y6sv9h2Qbi` | success | `27,800,000` |
| `334/334/334` | `1002` | `EXeSrBjD86uPU3efBXmCGNWXQodUGspRJ1EMDEWqUBhS` | failure | `27,600,000` |
| `500/0/0` | `1000` | `CDe4EMxJ6yAcvzf7pykRdSKRanw2nJ6p7mWScN9NAiX3` | success | `30,100,000` |
| `501/0/0` | `1002` | `24q5hz3pxPfWq6bSiJuTYDwomdv2nZkxAmBK1rZZxiwh` | failure | `29,800,000` |

Both over-bound effects contain the same error:

```text
MovePrimitiveRuntimeError(MoveLocationOpt(Some(MoveLocation { module:
ModuleId { address: 0000000000000000000000000000000000000000000000000000000000000002,
name: Identifier("dynamic_field") }, function: 14, instruction: 0,
function_name: Some("borrow_child_object") }))) in command 0
```

This is the CLI rendering of the native `MEMORY_LIMIT_EXCEEDED`; the pinned
runtime source gives the internal message `Object runtime cached objects limit
(1000 entries) reached` and substatus
`OBJECT_RUNTIME_CACHE_LIMIT_EXCEEDED`.

Setup/seal separation is visible in the transaction history:

- `333/333`: create `G3bMLc25zmy4guLKn1RgSfuBWHRCgs2qTXCKhYr7L41n`;
  style batches `7zwS4Y1HfaizDvkFpJSMBFAcEjKEu9sDEq15NZPTpXqo`,
  `C5UoTGDAzEgutuMF4LgnAvbTtkxUdERjvhBSBTYUauoL`,
  `H5sMutVKDHK5tGGzTWNJZtTL8ozcRqBu2GK2qZ1MD2f7`, and
  `QXZqgzRs2nhFoxjx6giTbnrZWiWMdKux9r3y3vXp5Tw`; color batches
  `CNs5ceLi4vZHkcwpueypxQEAGMR1eGbYRyHomdiHK644`,
  `8adxVZVGWhiNQcZaExV3AWCvF6UiPDX7yywN5nxRxBzQ`,
  `5yTGLbEGv2y8fHeTA2s8r7AzNbSARFXVtPy556CL5AqR`, and
  `T2EKfzd87bDAKhAAcKw7f2i22tDVEcvD9nSJDGYGhGC`; then the seal above.
- `334/334`: create `FZFKvSCve85nu2pr86MG4TRVraZURyvdCbabS5CAv4RE`;
  style batches `J6WiXKVW3MeEV9Q6QMrq9pFHwJFKCTqaUG1dmRfx7jwu`,
  `CpHZhFKhngUWxbTdafFZtntWGhXaPjZ1AiTuNVfUSK1D`,
  `8W5Sv38bib4fUycWCCgK4f9FdkoyWMqk763ZAF1mNubF`, and
  `6zp4edA6QRx9RkAZ63T3iqcNVnVUeUGGcaTYhoigrbDR`; color batches
  `J6Mo1wHjZUbJWVWiiKPQs8wx7YRtGHt9RiBT3nNLziyQ`,
  `5xnebGd8SEu54q7XvxV9WkvHKuPZXEt22ENUC1FEHbaz`,
  `AksVFwuXfwG8eKtUEqmiVicXctBpe3DRyvPBVMb4rWmR`, and
  `GYwz2iXsQLGmratq4an1E2dXrVbWs2ruKCWuHZUy55VX`; then the seal above.
- `500/0`: create `7mN3HrDBS2UKYTtnLupcMirQbbjkaUgwVXs34UKsGbCK`;
  style batches `CuFzG9jxmarAJXXjhBnYGbJqwPAGHUZMz4xPgKsHtgjb`,
  `J95Ht5AB8oHeEUdyTQch8y1gWho3GbtbyqcKRSSXwgeJ`,
  `2dQwmeVpcXAPSRrx6mEbBcccw39jcJbVphMcMHrf61KY`,
  `39FMtXpjZhAR3QUijfM1uxbzJKPXo6TMqBTaSeGRLQsy`, and
  `GzbNRMvAwYRH5x3fJNRs2t5o4qRfXpqhpsAPodaqwZDx`; then the seal above.
- `501/0`: create `283EpzsyYyAgg2Ns6CxFSYxqMwEMquEXJVF9oBRhHRYp`;
  style batches `Q9QixvZkTduoANevpYswgyGxosqXCYvVkAoG32mHJUa`,
  `6kKPVg4UGgQ1ri9h93W652FnnUb6VQXDhuvoZF5JzJES`,
  `7gL3i5Dpd5nG8eLPETKqApziCoFk2DzTeENvuRXJH6Q2`,
  `H6mqxsSJ72XHy39WZ2sVq6PkkVLLrvWauq7HpqgvFwvh`,
  `Eon512DNggTK9272DUTKiDnCM8H7Mdhy7L1sY872cKVF`, and
  `DzibeAxJcCZpYmKZXoFpkcfVFoSaQ2PcfLHjoLtbHoLs`; then the seal above.

The measured scratch constructor computed expected commitments in its own
create transaction, which cannot contribute gas or cached objects to the later
seal transaction. The committed harness is stricter: its constructor accepts
seven offline-computed commitments, so even fixture creation no longer performs
an `O(S+C)` commitment loop on chain.

## Offline BCS fixture generation

The dependency-free generator implements the exact BCS layouts and rolling
SHA-256 commitments used by `base_registry_v8`:

```bash
node move/animacraft_v8_seal_cap_harness/scripts/generate_commitments.mjs \
  --self-test

node move/animacraft_v8_seal_cap_harness/scripts/generate_commitments.mjs \
  --styles 333 --unique-colors > /tmp/seal-cap-333.json

node move/animacraft_v8_seal_cap_harness/scripts/generate_commitments.mjs \
  --styles 500 --colorless > /tmp/seal-cap-500.json
```

The self-test compares all seven generated commitments against the exact
`333/333` expected commitments read back from the metered localnet registry.
The aggregate is:

```text
SA9dTScJA+R+BgrLgbJE851ghDgyyeO94FWKmTQ91zc=
```

`createRegistryPureArgs` in the JSON contains, in order, `style_count`, the
unique-color boolean, and the seven `vector<u8>` commitment arguments. The two
object arguments (`ProtocolConfigV8`, `0x6` Clock) precede those pure arguments.
For example, the individual vectors can be passed to `sui client call` as
quoted compact JSON arrays:

```bash
tracks=$(jq -c '.commitments.tracks.moveArg' /tmp/seal-cap-333.json)
parts=$(jq -c '.commitments.parts.moveArg' /tmp/seal-cap-333.json)
items=$(jq -c '.commitments.items.moveArg' /tmp/seal-cap-333.json)
styles=$(jq -c '.commitments.styles.moveArg' /tmp/seal-cap-333.json)
colors=$(jq -c '.commitments.colors.moveArg' /tmp/seal-cap-333.json)
rules=$(jq -c '.commitments.rules.moveArg' /tmp/seal-cap-333.json)
aggregate=$(jq -c '.commitments.aggregate.moveArg' /tmp/seal-cap-333.json)

sui client call \
  --package "$HARNESS_PACKAGE" \
  --module seal_style_cap_harness \
  --function create_registry \
  --args "$PROTOCOL_CONFIG" 0x6 333 true \
    "$tracks" "$parts" "$items" "$styles" \
    "$colors" "$rules" "$aggregate" \
  --gas-budget 100000000000 --json
```

Append styles/colors in bounded transactions (the measurements used batches of
100), then call `seal` in a final transaction with only the registry, Root, and
AdminCap arguments. Do not combine setup and seal in one PTB.

## Instruction evidence

The production disassembly for `assert_style_color_references` has PCs `0..53`.
Its successful direct Move-bytecode path is deterministic:

```text
no color reference per style:       12 + 31*S instructions
one color reference per style:      12 + 43*S instructions
```

Thus the direct assertion-body counts at the measured pass boundaries are:

```text
333 styles, all colored: 14,331
500 styles, colorless:   15,512
```

These counts exclude instructions inside called functions and native execution.
An Sui `--trace instruction-only` run of the existing one-style colorless Core
test observed 43 direct / 83 subtree instructions in the assertion and 50
direct / 437 subtree instructions in the whole seal call. The trace is useful
for instruction accounting only. It cannot prove the execution cap because
`crates/sui-move/src/unit_test.rs:215-220` constructs the unit-test
ObjectRuntime with `is_metered=false`. The metered localnet transactions above
are the limit proof and their effects are the authoritative gas evidence.

## Verification commands

```bash
sui --version
sui move build --path move/animacraft_v8_seal_cap_harness \
  --force --warnings-are-errors
node move/animacraft_v8_seal_cap_harness/scripts/generate_commitments.mjs \
  --self-test
sui move build --path move/animacraft_v8_core \
  --force --disassemble --warnings-are-errors
node move/animacraft_v8_core/scripts/measure_package_size.mjs
git diff --check
git diff --exit-code 4333c4b -- move/animacraft_v8_core/sources
```

The localnet protocol values were queried directly with `sui_getProtocolConfig`
and not inferred only from source. No Mainnet RPC, package, object, or wallet was
used.

## Regression recommendation

Keep both boundary pairs as metered regressions:

1. `333/333/333` succeeds and `334/334/334` fails.
2. `500/0/0` succeeds and `501/0/0` fails.

For a production validator, count distinct referenced color pairs from the
style rows and reject before publication when `2*S+R>1000`. Also keep a protocol
version/config guard: the cap is proven for Sui 1.76.1 protocol version 130 and
must be remeasured if the ObjectRuntime configuration or seal implementation
changes.

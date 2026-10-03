# Native Soul real-package VM graph

This harness snapshots all eight current local packages without changing any
`.move` bytes or removing tests. It rewrites only generated manifests: each
package receives a distinct test address (`0x100`–`0x107`), and local dependencies
point at the corresponding snapshot. Original manifests and every source/test
file are SHA256-verified before and after compilation. Git dependency revisions
are preserved; the harness pins Sui/MoveStdlib to the established revision.

No original manifest, wallet, network deployment, config or authority is changed.
The temporary graph and logs remain available for diagnosis; the script does not
recursively delete files. These addresses must never be used as deployed IDs.

```sh
node scripts/native-soul-test-graph.mjs --soulidity-root /absolute/path/to/soulidity --check smoke
node scripts/native-soul-test-graph.mjs --soulidity-root /absolute/path/to/soulidity --check build
node scripts/native-soul-test-graph.mjs --soulidity-root /absolute/path/to/soulidity --check full
node scripts/native-soul-test-graph.mjs --soulidity-root /absolute/path/to/soulidity --check bootstrap
node scripts/native-soul-test-graph.mjs --soulidity-root /absolute/path/to/soulidity --check acceptance
node scripts/native-soul-test-graph.mjs --soulidity-root /absolute/path/to/soulidity --check packages
node --test test/harness/native-soul-v8/native-integration-coverage.test.mjs
```

Omit `--check` to prepare and verify only. `--animacraft-root` explicitly overrides
the current script's repository. Each run prints its `graph.json` and preserves
the exact command, exit status and output hash beside the log.

`packages` runs all eight package-local suites, then the unfiltered full integration
harness on one snapshot. It stops at the first failure, retaining per-command evidence.
Zero-test packages are not functionality coverage. Sources are checked before/after
every command. Explicit source roots may relocate known absolute dependency paths;
unknown dependencies and conflicting name/path mappings reject. This does not select
a cloud source revision or certify deployment or wallet acceptance.

- `smoke` runs the real Core/Seal/Runtime/Output/native Soul type-identity VM case.
- `build` builds the production eight-package graph, including Physical, Market
  and Release, without treating a build as VM acceptance.
- `full` compiles all eight packages and all their test-only dependencies, then
  runs the eight-package identity case. Existing broken fixtures remain compile
  errors; a test-name filter does **not** hide them.
- `bootstrap` compiles the same complete test graph, then selects the real
  native-binding/catalog/setup/caller-install scenario in `full/sources/bootstrap.move`.
  That entry uses actual Soul types, all six real config constructors, the frozen
  replacement and the two production caller-cap installers. Its setup functions
  also compile in `build`; build success does not prove their VM execution.
  Protocol creation, package commitments and Seal key-server IDs in the scenario
  are explicit VM fixtures, not a deployable release or real content certification.
- `acceptance` compiles all eight packages including dependency test code, then
  executes every test in the upper harness without a name filter. Sui runs tests
  in the selected package, not dependency-package tests: the first executable
  graph h8E5wF ran94 upper scenarios, not all lower unit tests. This is the native
  integration VM gate, not the entire release test matrix; lower package unit
  suites must also run separately for full release acceptance. A bootstrap pass
  cannot certify relocated Physical/Release/Market scenarios.

Shared upper fixture entry: `bootstrap::initialize_for_testing` returns actual
protocol/config IDs and the same Walrus System used by the storage policy.
Additional tuples reuse that System through `initialize_with_system_for_testing`;
do not allocate the official fixed-ID dummy System twice. The caller retains
Scenario ownership. `active_maker.move` performs actual author draft/seal/activation;
`pack_player.move` performs Pack creation/admission/access/selection;
`native_completion.move` performs actual completion authorization and native mint.
`native_equipment_integration.move` consumes that mint to test equipment and frozen
original provenance. These are implemented fixtures, not executed acceptance until
the complete graph passes. No lower package may import this upper module or invent
its own role capabilities to avoid the real setup.

The coverage-inventory JS test preserves the original Physical63/Market15 scenario
names across each lower module and its corresponding upper integration module,
rejecting omitted/duplicated cases. This is a source coverage guard, not equivalent
assertion review or VM execution. Retired SoulBundle scenarios must exercise the
approved native-Soul replacement semantics, never recreate the old issuer.

The source view intentionally includes all `sources/` and `tests/` files.
Stale fixtures must be repaired in their real source packages, then a new
snapshot generated. This does not require retaining obsolete product paths:
an obsolete test may be replaced together with its approved replacement product
implementation and equivalent relevant positive/negative coverage. In particular,
the old Market CanonicalSoul bundle is not a compatibility requirement for fresh
native Souls whose Output/Receipt are frozen. Do not strip tests only in the
snapshot to game acceptance, invent authentication, or restore obsolete products
just to make old fixtures pass.
Historical bootstrap evidence: graph `native-soul-v8-graph-MR7XuG` production build
passes with the new bootstrap entry. `bootstrap` still fails during dependency
test compilation (489 cascading diagnostics across Physical/Release/Market);
it has NOT executed the scenario. Every original/snapshot source and manifest was
verified before and after both commands. The lower inline integration fixtures
still use retired readiness/cap APIs. Move cross-package scenarios into an upper
test module with actual initialization and equivalent positive/negative behavior;
do not make lower modules depend on the upper fixture or recreate fake role caps.
This is not completion → native mint → DF9 → DF10 → close, consumer bootstrap VM,
localnet, live-chain, or release acceptance.
Latest changing implementation and evidence are recorded only in
`docs/codex/CURRENT.md`; do not treat this historical diagnostic count as current.

Installed Sui 1.78.1's ordinary `move test` ignores `--pubfile-path`; only its
`move build --dump-bytecode-as-base64` publication branch uses that file. The
generated-manifest graph avoids that experimentally verified false shortcut.

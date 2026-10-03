# Current Base registry seal-cap evidence

This test-only harness measures the current schema-2 production `base_registry_v8` module under the pinned Sui mainnet-v1.80.1 executor (executable source commit `671ba71e69c711ded76a11ef90297c4f2d5ac474`), protocol 137. The framework remains pinned to `722ac4fcf4841346c91775f596c4ce23fb7fbd0f`. It is not a production publication package or deployment approval.

## Current measured boundary

Every setup transaction must succeed before the independent, single-call `core_v8::seal` transaction. The fixture drives real author-row commitments and current row ABIs; production Base source and normal-build bytecode must match exactly.

The seal object-cache demand is `2 × parts + 2 × styles + distinct referenced color channels + 2 × items + distinct referenced assets`. Protocol 137 allows 1,000 cached objects. Each measured scenario has one Part.

| Scenario | Styles | Referenced colors | Items | Referenced assets | Demand | Result |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Shared item/asset, colored | 331 | 331 | 1 | 1 | 998 | Success |
| Shared item/asset, colored | 332 | 332 | 1 | 1 | 1001 | Failure |
| Shared item/asset, colorless | 497 | 0 | 1 | 1 | 999 | Success |
| Shared item/asset, colorless | 498 | 0 | 1 | 1 | 1001 | Failure |
| Distinct item/asset per style | 199 | 0 | 199 | 199 | 997 | Success |
| Distinct item/asset per style | 200 | 0 | 200 | 200 | 1002 | Failure |

The failing envelopes retain exact dynamic-field VM error locations. Matching failure at the predicted boundary supports the cache-limit inference; a generic VM error alone is not proof of its cause.

The measured module is 28,492 bytes, zero-address SHA-256 `14948901f5d3337e32492468d58e7fc945c271d37005788fcb05ab6f39ee07d2`. Full Core is recorded separately (97,740 bytes, 9 modules). The same-run protocol RPC declares `max_move_package_size=102400`, leaving 4,660 bytes of protocol package headroom.

## Scope and limits

The slim package stubs unrelated Core entry points and Maker construction. Maker seal authorization/commitment installation uses only top-level Root/Admin fields; it does not add dynamic-field cache reads. Thus this is evidence for the production Base module's object-cache boundary, not a claim that fixture gas equals full Core gas or that the full author activation workflow was reproduced.

No production source, ABI, wallet, network configuration, or permission policy is changed. Setup uses a fresh generated local identity and loopback validator. All complete RPC envelopes, typed effects, gas, raw effects, original digests, provenance, exact fixture/source hashes and protocol configuration are retained in `evidence/`.

## Reproduce

Use the exact pinned Sui binary on PATH (or set `ANIMACRAFT_SUI_BINARY` to its absolute path) and Node 22:

```sh
npm run move:seal-cap:quick
npm run move:seal-cap:localnet
```

The quick gate verifies exact artifact and scenario allowlists, hashes, protocol profile, field-limit evidence, fixture source identity, and isolated normal-build bytecode/disassembly identity. It never trusts or modifies production build directories. Isolated build diagnostics remain in a fresh temporary directory.

The localnet runner first runs the quick gate, creates an isolated network, runs each setup fully, measures only the separate seal, and compares exact typed effect shapes, gas, raw-effects length and expected error with the recorded evidence. It bounds execution, rejects non-loopback configuration and cleans its owned localnet workspace. No existing user key configuration is used.

From this harness directory, the explicit maintenance command `node scripts/run_localnet_replay.mjs --record-protocol137-evidence` regenerates same-run protocol and scenario envelopes. Source/hash metadata must also be refreshed deliberately and the quick gate must pass; recording alone does not approve new production bytes.

## Historical evidence

`historical-protocol135/` preserves the previous nine evidence files and Base source unchanged. Its protocol profile, bytecode and boundary counts are not current approval. The old `../animacraft_v8_field_limit_protocol135.json` is historical; the current verifier reads only `../animacraft_v8_field_limit_protocol137.json`.

`historical-schema1/` preserves the superseded manifest and four original RPC envelopes unchanged for audit. Its 9,389-byte module, old row ABI and 333/500 claims do not approve current bytes. The obsolete schema-1 companion package and commitment generator were removed; the only executable measurement driver is `fixture/slim-core`.

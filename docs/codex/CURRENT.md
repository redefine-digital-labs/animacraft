# Current phase

- Phase: `v8-mainnet-release-and-vercel-cutover`
- Status: `in_progress`
- Branch: `codex/v8-mainnet-release`
- Objective: finish the audited release runner, publish and attest all seven v8 packages plus init/bootstrap on Sui Mainnet, replace all production JSON-RPC transport with gRPC plus GraphQL discovery, generate real production configuration, and deploy the verified build to Vercel production.
- Constraints: no guessed secrets or commitments; no replacement signing for uncertain outcomes; irreversible Mainnet or production actions only after all documented hard gates pass; protected decryption remains explicitly unavailable until a server-only Enoki credential path is supplied and tested.
- Acceptance: focused and full Web/Move/Protocol133 gates pass; release WAL reaches verified COMPLETE with exact chain certificate; production source/bundle contains no Sui JSON-RPC client or fallback and uses gRPC for authoritative reads/writes plus GraphQL for indexed discovery; production config contains no placeholders; Vercel production and custom domain serve the attested commit/config; rollback evidence is recorded.
- Detailed spec: `docs/codex/MAINNET_V8_RELEASE_SPEC.md`
- Verified so far: production transport is gRPC authority plus GraphQL discovery with no JSON-RPC fallback; Web/runner focused suites, seven-package Move tests, field/size gates and adversarial probes pass; the release runner now cold-rebuilds every publish ordinal from the approved archive, revalidates stage authority immediately before signing, verifies all seven packages again at ordinal 9, and writes separate chain/deployment certificates.
- Current boundary: no Mainnet transaction has been signed or broadcast and no package has been published; `protectedDecryptionReady` remains false because the Enoki server-only credential path is not an input to this release.
- Next action: pass the Protocol 133 harness and final full repository gates, commit one clean release candidate, re-read Mainnet signer/balance/protocol/committee with gRPC, then prepare the durable WAL and execute only through the explicit `expectedExecutionPlanId` / `expectedReleaseId` gates before Vercel preview and production promotion.

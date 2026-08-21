# Contributing

Use a feature branch and a reviewed pull request. Keep each change bounded and
avoid unrelated refactors. Before review, run:

```bash
npm ci
npm run check
npm run move:test
```

For Move or transaction changes, also run `npm run move:build`,
`npm run move:probes`, and `npm run move:size`. Frontend changes should include
browser evidence for disconnected browsing, wallet/network errors, and the
affected action or recovery state.

Do not introduce another product schema, compatibility read, migration,
fallback, caller-authored authority, or parallel transaction path. Historical
behavior is recoverable from Git history; it is not part of the delivery
surface.

Core maintainers must review the seven Move packages, runtime attestation,
compiler, Market builders, finalized verifier, Wallet Standard integration,
and durable WAL/CAS changes. Never commit generated `dist` or Move build output,
credentials, signed transactions, or private wallet material.

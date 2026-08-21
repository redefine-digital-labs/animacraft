# Security Policy

Report exploitable contract, wallet, payment, custody, recovery, or object
integrity issues privately through a GitHub Security Advisory. Include the
affected commit, seven-role package tuple, transaction digest when one exists,
reproduction, and impact. Never send a mnemonic, private key, wallet export,
session key, or recovery phrase.

Only a web release whose commit and complete seven-role runtime attestation are
recorded together is supported. The checked-in placeholder runtime is a locked
release candidate and is not a live deployment.

Changes to Move authority, Receiving custody, payment splits, runtime lineage,
TransactionData construction, Wallet Standard integration, IndexedDB WAL/CAS,
or Core V2 finalized readback require:

- all JavaScript and seven-package Move gates;
- positive and adversarial tests for the affected typed action;
- a fresh P0/P1 review independent of the implementer;
- an exact deployment diff and explicit multisig approval before publication.

The browser has no private application signer. A web rollback cannot undo Sui
effects. Ambiguous signed outcomes must be queried by their saved digest and may
only replay identical bytes.

For an incident, stop release promotion and signing gates, preserve the durable
receipt/WAL evidence, reproduce against the recorded commit and package tuple,
review a fix, rerun every gate, and publish a post-incident record without
exposing active exploit details.

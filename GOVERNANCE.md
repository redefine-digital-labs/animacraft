# Repository and Package Governance

The seven Maker v8 packages have distinct upgrade capabilities and one reviewed
release catalog. Package publication or upgrade requires a dedicated Sui
multisig, a source commit, pinned Sui toolchain, dependency locks, package
digests, transaction digest, complete JavaScript/Move evidence, and independent
review.

Protect `main` with pull requests, required checks, conversation resolution,
CODEOWNERS review, and no force pushes. A release author must not be its only
reviewer. Runtime configuration, browser signing policy, recovery storage, and
workflow changes receive the same review level as Move changes.

Animacraft and Soulidity remain separately governed repositories and packages.
An adapter may pin only an independently verified Animacraft release; neither
project shares an upgrade capability or silently changes the other repository.

Maker revenue belongs to the typed per-Maker treasury and its current on-chain
authority. Repository or package maintainers do not obtain a hidden application
signer or confiscation path.

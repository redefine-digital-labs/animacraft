# Contributing to Animacraft

Animacraft is an open-source creator tool and Sui Move protocol for fully on-chain character makers.

## Branch Model

- `main` is the stable branch.
- Do not push directly to `main`.
- Create feature branches from `main`:
  - `feat/<short-name>`
  - `fix/<short-name>`
  - `docs/<short-name>`
  - `codex/<short-name>`

## Pull Request Rules

Every change should go through a pull request.

Before requesting review:

1. Explain the product or protocol change clearly.
2. Include screenshots for frontend changes.
3. Include contract/build notes for Move changes.
4. Keep unrelated refactors out of the PR.
5. Confirm no generated build output is committed.

Recommended merge rule:

- Squash merge small product/frontend updates.
- Merge commit larger protocol milestones when preserving commit history is useful.

## Required Checks

The `Repository hygiene` workflow should pass before merge. For Move protocol changes, run locally:

```bash
cd move/animacraft
sui move build
```

## Repository Ownership

Core maintainers should review changes touching:

- `move/animacraft/`
- creator workflow and publishing logic
- licensing, royalties, and on-chain provenance rules
- wallet, Walrus, or Sui transaction integration

## Release Notes

For user-facing changes, PRs should include:

- what changed
- who it affects
- any migration or creator action needed

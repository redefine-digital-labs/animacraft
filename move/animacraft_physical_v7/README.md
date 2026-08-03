# Animacraft Physical v7

Physical v7 is Animacraft's companion Move package for concrete Style assets,
Soul-bound wardrobes, and on-chain equip/unequip operations.

It is intentionally separate from the upgradeable Animacraft Core package.
The combined Core + v7 bytecode exceeds Sui Mainnet's package object-size
limit, while this split keeps one product and one audited protocol dependency
graph:

```text
Animacraft Core (v4-v6)
          ↑
Animacraft Physical v7
          ↑
Soulidity
```

The package must be published against the exact reviewed Core callable package
ID. Its protocol initializer still consumes the canonical v6 AdminCap marker,
so a second physical v7 configuration cannot be initialized by replay.

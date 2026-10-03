# Historical UI regression inputs (test only)

These eight `.txt` files are exact original Git blob bytes for the donor reads
in the Player, Workspace and pure-view regression tests. The manifest records
each original full commit, source path, Git blob ID, byte length and SHA-256.
The shared reader verifies both hashes before any comparison or locale import.
No Git history or network lookup is needed when running the tests.

The closure is seven files from `aac90dbc` and the Player workspace from
`93d16531`; the latter preserves the existing approved Player comparison.
Full original files retain the bidirectional DOM/class/action/ARIA comparisons
and all five historical locale dictionaries without deriving expectations from
the current implementation. Only the locale modules are evaluated, as before.

These are historical test data, not an executable release branch, a production
configuration, or authority to reintroduce old interfaces. Do not ship or import
them into the product. Updating this baseline requires deliberate provenance
review; never regenerate it from the implementation under test.

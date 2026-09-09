# Vector Memory Boundary Preservation Ledger

## Scope

- Align vector indexing with RP-Hub's visible-main-text boundary.
- Prevent conversation indexing, patrol, retry, and import from racing.
- Remove duplicate or transport-polluted vector cache rows on load/import.
- Synchronize the runtime fix into the derived `无限恐怖TRPG` card.

## Preserved Surfaces

- Conversation history and prompt assembly order.
- World-book retrieval, regex display transforms, and state synchronization.
- Int8 vector encoding, similarity search, recent-floor exclusion, retry policy, and player settings.
- Full-save v3 structure and all non-vector local data.
- Existing card GUI, story content, combat incapacitation outcomes, and deterministic resource settlement.

## Allowed Changes

- `ui/runtime/regex-engine.js`: expose reusable reasoning/transport cleanup.
- `ui/runtime/vector-memory-engine.js`: clean memory text, serialize mutations, deduplicate cache rows and ledgers.
- `tools/test-model-runtime.mjs`: add regression coverage for transport exclusion, concurrency, and import cleanup.
- Generated release artifacts after all audits pass.

## Baseline

- Template commit: `34786d3eafa966a79cb13f9bbc888afcdaa7bc33` (dirty worktree; existing edits retained).
- RP-Hub comparison: `5cbcddc21a942b219fedbe9cdf132e78ddd0226f`.
- Template vector engine SHA-1 before this change: `0b57c06cebb08651adb58fdb064a51153fb5ea47`.
- Derived card vector engine SHA-1 before this change: `49908b467bad96567461acb71354c583cf1db91a`.

## Fault Evidence

- The 2026-08-02 test save contains 190 vectors, including COT, attack protocols, dice results, and image prompts.
- RP-Hub indexes `parseCot(message.content).main` and guards one batch extractor with a rescan flag.
- The embedded runtime previously removed only code blocks and HTML tags before embedding, leaving COT bodies after tag removal.
- Independent post-generation and patrol calls could calculate the same missing chunks before either persisted them.

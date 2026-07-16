# th-address-latent

Browser-compatible Thai address extraction using typed candidate evidence, a
small sparse latent residual ranker, soft candidate pruning, and deterministic
validation. Training happens offline; parsing is local and fast.

## Why Validator and Pruner are separate

- **Scorer** ranks proposed spans. Deterministic evidence supplies the base score; a gated sparse vector may apply a bounded residual correction.
- **Pruner** searches those hypotheses and softly penalizes overlaps, duplicate fields, unusual order, and inconsistent administrative tuples. It may keep an unusual but plausible result.
- **Validator** checks the completed result: source offsets, phone/postcode formats, administrative consistency, normalization, confidence, and abstention. It does not create missing candidates.

This follows katgpt-rs's separation: `ConstraintPruner` removes impossible branches while the Validator is the complete deterministic-referee system.

## Commands

```bash
bun install
bun test
bun run typecheck
bun run build
```

Build the promoted sparse-residual resource:

```bash
bun run build:resources \
  --dataset ~/Workspace/indie/thai-address-synth-dataset/data/generated/construction-v1.jsonl \
  --dataset ~/Workspace/indie/thai-address-synth-dataset/data/generated/name-robust-v1-2040-r1.jsonl \
  --gazetteer ~/Workspace/indie/thai-address-synth-dataset/data/subdistricts.json \
  --output resources/generated/construction-v3-residual-name-d2048.json \
  --resource-version construction-v3-residual-name-d2048 \
  --seed 20260720 \
  --dimension 2048 \
  --max-character-ngram 4 \
  --context-window 12 \
  --epochs 4 \
  --max-negatives 8 \
  --name-residual-scale 1 \
  --address-residual-scale 0 \
  --dataset-balance equal-family \
  --negative-policy other-spans \
  --fit-mode pairwise-residual
```

Run the exploratory head-to-head benchmark:

```bash
bun run bench \
  --dataset ~/Workspace/indie/thai-address-synth-dataset/data/generated/construction-v1.jsonl \
  --dataset ~/Workspace/indie/thai-address-synth-dataset/data/generated/name-robust-v1-2040-r1.jsonl \
  --resources resources/generated/construction-v3-residual-name-d2048.json \
  --legacy ~/Workspace/indie/thai-address-splitter \
  --output .bench-results/construction-v1.json
```

Run an aggregate-only benchmark over a structured recipient list. Exact input
and parsed values are never written to the report; unstructured blocks must
match the reviewed supplement fixture:

```bash
bun run bench:list \
  --input /path/to/private-recipient-list.txt \
  --resources resources/generated/construction-v3-residual-name-d2048.json \
  --min-exact-accuracy 0.95 \
  --output .bench-results/recipient-list.json
```

The list benchmark defaults to a 95% exact-record acceptance threshold and exits
non-zero below it. For 58 records this requires at least 56 exact records.

`bench/private/` is gitignored; keep private input lists there.

## Candidate engine

`createAddressParser` compiles resource-derived indexes once. Each parse then
builds immutable context and runs structured, location, and segment candidate
sources through a seed store, typed evidence rules, scoring, pruning, and final
validation. See `CONTEXT.md` and `docs/adr/0001-deep-candidate-engine.md` for the
domain language and decision.

Pass `{ diagnostics: "full" }` to receive candidate evidence, pruning outcomes,
pre-candidate rejection rules, and exact validation abstention reasons. Full
diagnostics may contain input text and should not be logged for private data.

The compatibility fields named `confidence` currently contain an uncalibrated
selection score. Diagnostics report `scoreSemantics: "uncalibrated-selection-score"`.

## Experimental fitting modes

Resource builds accept:

```text
--dataset-balance uniform-records|equal-family
--negative-policy output-only|other-spans
--fit-mode none|gold-centroid|candidate-contrastive|pairwise-residual
```

`pairwise-residual` learns from each gold candidate against hard candidates
produced by the real Candidate Engine. It also learns an explicit `NULL`
choice for absent fields. The learned score is a bounded correction to the
evidence logit, so a missing direction or a zero label scale reproduces the
evidence-only score exactly. `none` writes that evidence-only parser.

`bun run build:resources` exits non-zero if the built resource loses its
evidence-only ablation. Pass `--skip-gate` to write an unpromoted experiment
artifact anyway; it still refuses to overwrite the default shipped output path,
so an unpromoted build must target an explicit `--output`. Check that every
shipped resource still passes its recorded gate, including that only `NAME`
may carry a nonzero residual scale, with:

```bash
bun run check:resource-gate
```

CI runs this check before building the library and demo, on pushes to `main`
and on pull requests. See `docs/adr/0002-resource-promotion-gate.md`.

## Browser API

```ts
import { createAddressParser } from "th-address-latent";

const parser = createAddressParser(resources);
const result = parser.parse("นายทดสอบ ใจดี 081-234-5678 บ้านเลขที่ 1 ปทุมวัน กรุงเทพมหานคร 10330");
```

The browser receives a frozen resource artifact. It does not fit directions, mutate model weights, run backpropagation, read JSONL, or access the filesystem.

## Latent feature configuration

Every artifact records its feature schema, hash dimension, character n-gram
range, and context window. The promoted `candidate-hash-v3` schema hashes span
text, nearby context, boundaries, shape, candidate source, evidence-rule IDs,
and distances to useful markers into a sparse 2,048-dimensional vector. Runtime
validates the schema before using a frozen resource. Rebuild resources whenever
feature semantics change.

## Current benchmark verdict

The shipped resource activates a sparse residual only for `NAME`. Enabling the
same ranker for `ADDRESS_DETAIL` improved synthetic scores but regressed the
private acceptance list, so address selection remains evidence-only.

| Leakage-safe partition | Sparse residual | Evidence-only | Gain |
|---|---:|---:|---:|
| Development (401) | 80.3% | 72.6% | +7.7 pp |
| Evaluation (259) | 64.5% | 62.2% | +2.3 pp |

The aggregate-only 58-record private acceptance benchmark remains 56/58 exact
(96.6%), with a 10.19 ms p95 on the measured run. The synthetic evaluation p95
is 6.18 ms, only 0.40 ms above evidence-only. These are regression and
promotion gates, not claims of 95% production accuracy.

## Evaluation policy

The loader preserves generator-declared train/evaluation provenance and template
family. Records are partitioned into train, development, evaluation, and
excluded sets. A complete authoritative location tuple never crosses partitions;
generator-evaluation template families are admitted only to evaluation, and
generator-train families only to train/development. Incompatible cross-products
are excluded. The current combined split is 1,512 train, 401 development, 259
evaluation, and 669 excluded.

Selection gold for `NAME` and `ADDRESS_DETAIL` comes from the annotated source
span after surface normalization. Dataset expectations that expand abbreviations,
correct typos, or rewrite spacing are normalization tasks and no longer count as
candidate-selection failures.

The benchmark reports an evidence-only ablation (the `noDirections` report key)
using the same retrieval, pruning, and validation with frozen latent directions
removed. The latent component has demonstrated gain only when it beats that
ablation, not merely when the complete hybrid beats the legacy regex parser.

Synthetic results remain exploratory. Further address-ranker work needs a
separately seeded, manually reviewed real-world gold set, especially ambiguous
recipient/address boundaries and missing fields. Gazetteer provenance and
redistribution rights must be resolved before publishing generated browser
resources.

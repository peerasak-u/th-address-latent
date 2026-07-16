# th-address-latent

Browser-compatible Thai address extraction experiment using frozen character-latent directions, soft candidate pruning, and deterministic validation.

## Why Validator and Pruner are separate

- **Scorer** proposes and scores possible spans. Its frozen direction vectors summarize labeled construction examples.
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

Build a deterministic local resource artifact:

```bash
bun run build:resources \
  --dataset ~/Workspace/indie/thai-address-synth-dataset/data/generated/construction-v1.jsonl \
  --dataset ~/Workspace/indie/thai-address-synth-dataset/data/generated/name-robust-v1-2040-r1.jsonl \
  --gazetteer ~/Workspace/indie/thai-address-synth-dataset/data/subdistricts.json \
  --output .bench-results/resources/combined-v3-gold.json \
  --resource-version combined-v3-gold \
  --seed 20260720 \
  --dimension 512 \
  --max-character-ngram 4 \
  --dataset-balance equal-family \
  --negative-policy other-spans \
  --fit-mode gold-centroid
```

Run the exploratory head-to-head benchmark:

```bash
bun run bench \
  --dataset ~/Workspace/indie/thai-address-synth-dataset/data/generated/construction-v1.jsonl \
  --dataset ~/Workspace/indie/thai-address-synth-dataset/data/generated/name-robust-v1-2040-r1.jsonl \
  --resources resources/generated/construction-v2-ngram4-d512.json \
  --legacy ~/Workspace/indie/thai-address-splitter \
  --output .bench-results/construction-v1.json
```

Run an aggregate-only benchmark over a structured recipient list. Exact input
and parsed values are never written to the report; unstructured blocks must
match the reviewed supplement fixture:

```bash
bun run bench:list \
  --input /path/to/private-recipient-list.txt \
  --resources resources/generated/construction-v2-ngram4-d512.json \
  --output .bench-results/recipient-list.json
```

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
--fit-mode gold-centroid|candidate-contrastive
```

Candidate-contrastive fitting uses generated wrong candidates as hard negatives.
It remains experimental and must beat the matching `noDirections` ablation
before promotion.

## Browser API

```ts
import { createAddressParser } from "th-address-latent";

const parser = createAddressParser(resources);
const result = parser.parse("นายทดสอบ ใจดี 081-234-5678 บ้านเลขที่ 1 ปทุมวัน กรุงเทพมหานคร 10330");
```

The browser receives a frozen resource artifact. It does not fit directions, mutate model weights, run backpropagation, read JSONL, or access the filesystem.

## Latent feature configuration

Every artifact records its feature schema and character n-gram range. Runtime accepts only the current `char-ngram-v2` schema, so frozen directions cannot be paired accidentally with changed feature semantics. The first controlled v2 experiment uses character 1–4 grams and a 512-dimensional hash vector. Rebuild resources whenever the feature configuration changes.

## Current exploratory verdict

Snapshot `construction-v1-1b063cf770f2` contained 473 records: 394 for direction construction and 79 location-grouped evaluation records.

| Parser | Exact-record accuracy |
|---|---:|
| Full hybrid with frozen directions | 10.1% |
| Same hybrid without directions | 12.7% |
| Legacy regex parser | 1.3% |

The hybrid pipeline currently handles the synthetic no-space format much better than the legacy parser, but the first character-centroid latent directions **hurt** exact-record accuracy. The latent mechanism has therefore not passed its ablation gate. Name/address boundary scoring is the main bottleneck; the next readout must beat `noDirections` before it becomes the default.

## Evaluation policy

The construction JSONL is used to build and debug the parser. Frozen direction fitting and evaluation are separated by complete authoritative location tuple. Both parsers receive only `raw` during evaluation. Both also have access to the full external gazetteer, so this split measures direction-fitting leakage rather than performance without location knowledge.

The benchmark reports a `noDirections` ablation using the same retrieval, pruning, and validation with frozen latent directions removed. The latent component has demonstrated gain only when it beats that ablation, not merely when the complete hybrid beats the legacy regex parser.

Synthetic results remain exploratory. A superiority claim requires a separately seeded, manually reviewed 300–500-record gold set plus anonymized real-world examples where legally available. Gazetteer provenance and redistribution rights must be resolved before publishing generated browser resources.

# Latent feature experiments

## Promoted sparse residual v3

The shipped `construction-v3-residual-name-d2048` artifact uses the
`candidate-hash-v3` sparse representation and pairwise hard-negative fitting.
The NAME residual scale is 1; ADDRESS_DETAIL is deliberately 0. This keeps the
address path evidence-only after every positive address scale regressed the
private list.

The loader now respects both complete location tuples and generator-declared
template provenance. The combined 2,841 records produce 1,512 training, 401
development, 259 evaluation, and 669 excluded records. Selection gold for NAME
and ADDRESS_DETAIL is derived from the annotated source span instead of desired
normalization rewrites.

| Leakage-safe partition | Sparse residual | Evidence-only | Gain |
|---|---:|---:|---:|
| Development exact | 322/401 (80.3%) | 291/401 (72.6%) | +7.7 pp |
| Evaluation exact | 167/259 (64.5%) | 161/259 (62.2%) | +2.3 pp |
| Evaluation NAME | 223/259 (86.1%) | 216/259 (83.4%) | +2.7 pp |

The evaluation exact-record gain is six records. No protected case-type or
dataset-family slice regresses. The aggregate-only private list remains 56/58
exact (96.6%), the same as evidence-only and above the 95% gate. The measured
synthetic p95 was 6.18 ms versus 5.78 ms evidence-only; private-list p95 was
10.19 ms versus 9.93 ms.

The frozen artifact is about 1.17 MB raw and 108 KiB gzip. It contains one
direction, so labels without an active residual do not pay sparse feature
extraction cost. See ADR-0003 for the design and limitations.

## Historical experiments

The sections below preserve the evidence that led to the current design. Their
numbers use superseded dataset contracts, location-only splits, or older feature
schemas and must not be compared directly with the promoted v3 results.

### Experiment: `char-ngram-v2`, 1–4 grams, 512 dimensions

This controlled experiment changes only the frozen latent feature representation:
1–3 character grams / 256 dimensions becomes 1–4 grams / 512 dimensions.
Candidate generation, pruning, validation, split seed, and benchmark remain unchanged.

- Feature schema: `char-ngram-v2`
- Resource artifact: `resources/generated/construction-v2-ngram4-d512.json`
- Artifact size: 1.1 MB raw / 112,659 bytes gzip
- Source split: 652 training records / 149 held-out location-tuple records

#### Benchmark result

- Frozen directions: 10.1% exact records (15/149); 49.0% name; 20.8% address;
  5.01 ms p95.
- `noDirections` ablation: 12.1% exact records (18/149); 49.0% name; 22.1%
  address; 4.45 ms p95.
- Legacy parser: 1.3% exact records (2/149); 4.0% name; 1.3% address;
  1.40 ms p95.

Frozen directions remain 2.0 percentage points below `noDirections`. This
experiment does not pass the latent ablation gate and must not be presented as
an improvement. It establishes a versioned feature/resource contract and a
reproducible baseline for the next isolated experiment.

The dataset now contains 801 records. These results cannot be compared directly
with the older 473-record README snapshot. Reproduce the report with:

```bash
DATASET=~/Workspace/indie/thai-address-synth-dataset/data/generated/\
construction-v1.jsonl
GAZETTEER=~/Workspace/indie/thai-address-synth-dataset/data/\
subdistricts.json

bun run build:resources \
  --dataset "$DATASET" \
  --gazetteer "$GAZETTEER" \
  --output resources/generated/construction-v2-ngram4-d512.json \
  --seed 20260720 \
  --dimension 512 \
  --max-character-ngram 4

bun run bench \
  --dataset "$DATASET" \
  --resources resources/generated/construction-v2-ngram4-d512.json \
  --legacy ~/Workspace/indie/thai-address-splitter \
  --output .bench-results/construction-v2-ngram4-d512.json
```

Future changes need a new feature-schema version when feature semantics change.
Rebuild frozen directions before runtime use.

### Combined dense fitting experiment

The 801-record construction family and 2,040-record name-robust family were
split together by complete location tuple: 2,272 training and 569 evaluation
records. Both v3 builds used equal-family record weighting. The gold-centroid
build included `OTHER` spans as negatives; the candidate-contrastive build used
wrong runtime candidates as hard negatives.

| Fitting mode | Exact | NAME | ADDRESS_DETAIL |
|---|---:|---:|---:|
| Gold centroid + OTHER negatives | 50.4% | 83.1% | 60.8% |
| Candidate contrastive | 52.7% | 80.5% | 67.5% |
| `noDirections` | 58.5% | 77.5% | 76.4% |

Candidate-contrastive fitting is materially better than the new centroid fit,
but it remains 5.8 percentage points below `noDirections` on exact records.
Neither v3 resource is promoted.

An aggregate-only 58-record recipient-list benchmark contained 38 structured
records and 20 blocks already present in the reviewed messy fixture. Results:

| Fitting mode | Exact | NAME | ADDRESS_DETAIL |
|---|---:|---:|---:|
| Existing public resource | 58.6% | 96.6% | 67.2% |
| Gold centroid + OTHER negatives | 37.9% | 96.6% | 44.8% |
| Candidate contrastive | 53.4% | 98.3% | 60.3% |
| `noDirections` | 60.3% | 98.3% | 69.0% |

The report stores checksums and aggregate metrics only. No raw recipient,
phone, address, expected, or parsed values are persisted.

### Chat dataset boundary-hint experiment

`chat-v2-scale-1500-r1.jsonl` has 1,500 chat-style records. The deterministic
split produced 1,200 training records and 300 held-out complete location tuples.
The frozen artifact is `resources/generated/chat-v2-scale-1500-r1-ngram4-d512.json`
with resource version `chat-v2-scale-1500-r1-ngram4-d512`.

This experiment adds deterministic candidate boundaries for recipient, phone,
and address labels, plus Thai administrative prefixes. Candidates containing
those labels are rejected; candidates immediately after recipient/address labels
receive label-specific evidence. The change fixes the primary extraction failure:
address accuracy rose from 0.0% to 26.7% and exact records from 0/300 to 19/300.

- Frozen directions: 6.3% exact records (19/300); 28.3% name; 26.7% address;
  6.07 ms p95.
- `noDirections` ablation: 11.0% exact records (33/300); 26.3% name; 34.7%
  address; 5.50 ms p95.

The latent directions improve name extraction but still reduce exact-record and
address accuracy relative to `noDirections`. This boundary change is retained as
an evidence-driven deterministic improvement; it does not pass the latent
ablation gate.

### Chat label-mix and pre-administrative boundary experiment

This experiment adds a serialized `label-mix-v1` scoring configuration and
tests separate latent weights for `NAME` and `ADDRESS_DETAIL`. The promoted
configuration keeps the 0.55 NAME mix and sets ADDRESS_DETAIL latent weight to
0. Candidate generation also recognizes `ชื่อ`, `เบอร์โทร`, and `ส่งที่` chat
labels, treats pipe/newline separators as boundaries, suppresses location
gazetteer matches inside recipient text, and suppresses embedded location terms
in delivery text before the first administrative prefix.

The promoted artifact is
`resources/generated/chat-v2-scale-1500-r1-ngram4-d512.json`, resource version
`chat-v2-scale-1500-r1-ngram4-d512-labelmix-a0`.

- Frozen directions: 75.0% exact records (225/300); 82.7% name; 89.7% address;
  4.79 ms p95.
- `noDirections` ablation: 73.7% exact records (221/300); 80.3% name; 89.0%
  address; 4.77 ms p95.

This is the first chat-v2 configuration to pass the latent ablation gate and
the 70% exact-record benchmark target. Results remain exploratory and
synthetic-only per the limitations above.

### Informal `อ.เมือง` abbreviation

The parser now recognizes `อ.เมือง` as a district shorthand when a province
appears later in the same message. It resolves the shorthand against the
province-constrained gazetteer tuple, so `อ.เมือง ... จ สกลนคร` yields the
canonical district `เมืองสกลนคร` while preserving the complete preceding
address detail, including `หมู่`, `ซอย`, and road text. Bare `เมือง` is not
treated as an administrative district candidate without the `อ.` context.
The same protection applies when the address line is supplied without a name
or phone prefix.

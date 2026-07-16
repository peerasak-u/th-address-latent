# Domain context

## Parser language

- **Parse context** — immutable facts scanned once from one raw message: phone and postcode ranges, field markers, separators, administrative prefixes, address hints, and the strongest province hint.
- **Candidate seed** — an unscored proposed output span with deterministic evidence and optional canonical location tuple IDs.
- **Candidate** — a scored proposal for one public output label. A candidate retains its source and the evidence-rule contributions that produced its evidence score.
- **Candidate source** — internal parser logic that proposes one class of seeds, such as structured values, location mentions, recipient text, or free-text segments.
- **Evidence rule** — a typed predicate with an explicit ID, priority, target label, and bounded score effect. Rules do not select final fields.
- **Location mention** — a surface occurrence resolved against one or more authoritative location tuples.
- **Recipient segment** — a free-text segment that may be proposed as `NAME`.
- **Address-detail segment** — delivery-location text before administrative location fields; it includes house, building, village, floor, room, alley, and road text.
- **Sparse residual ranker** — a frozen per-label hashed vector fitted offline from gold-versus-candidate pairs. It applies a bounded correction to the evidence logit and is not a language model.
- **Frozen direction** — a serialized sparse weight vector and bias for one output label.
- **Selection score** — the evidence score after an optional bounded latent residual. It is used for ranking and is not a calibrated probability.
- **Pruner** — beam search that selects at most one non-overlapping candidate per output label while rewarding location coherence and common ordering.
- **Validator** — deterministic final referee for offsets, normalization, minimum score, and complete administrative tuple consistency. It never invents candidates.
- **Resource artifact** — immutable browser input containing feature configuration, residual-scoring configuration, frozen directions, gazetteer tuples, partition provenance, promotion reports, and checksums.
- **Dataset family** — records produced for one construction objective, such as general construction or name robustness. Benchmark reports keep family results separate.
- **Selection gold** — an output label plus source offsets. Its canonical value is the surface-normalized source span, so the Candidate Engine is judged only on text it can select.
- **Normalization gold** — an optional desired rewrite such as typo correction or abbreviation expansion. It is a separate task from candidate selection.
- **Evaluation plan** — a train/development/evaluation/excluded partition that holds out both complete location tuples and generator-declared evaluation template families.

## Invariants

1. Source offsets are UTF-16 offsets and must reproduce the candidate text exactly.
2. The public output schema remains NAME, PHONE, ADDRESS_DETAIL, SUBDISTRICT, DISTRICT, PROVINCE, and POSTCODE.
3. Bare `เมือง` is not a district unless province-compatible administrative or sequence context resolves it.
4. Complete location tuples never cross train, development, and evaluation; generator-declared template families stay on their declared side.
5. A missing direction or residual scale of zero reproduces the evidence-only score exactly.
6. Frozen directions are promoted only when they beat evidence-only on both development and evaluation without regressing protected slices or the private acceptance gate.
7. Public fixtures and reports contain only synthetic, consented, or de-identified records. Private-list reports are aggregate-only.

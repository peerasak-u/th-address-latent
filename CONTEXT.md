# Domain context

## Parser language

- **Parse context** — immutable facts scanned once from one raw message: phone and postcode ranges, field markers, separators, administrative prefixes, address hints, and the strongest province hint.
- **Candidate seed** — an unscored proposed output span with deterministic evidence and optional canonical location tuple IDs.
- **Candidate** — a scored proposal for one public output label. A candidate retains the evidence-rule contributions that produced its deterministic score.
- **Candidate source** — internal parser logic that proposes one class of seeds. Current sources are structured values, location mentions, and free-text segments.
- **Evidence rule** — a typed predicate with an explicit ID, priority, target label, and bounded score effect. Rules do not select final fields.
- **Location mention** — a surface occurrence resolved against one or more authoritative location tuples.
- **Recipient segment** — a free-text segment that may be proposed as `NAME`.
- **Address-detail segment** — delivery-location text before administrative location fields; it includes house, building, village, floor, room, alley, and road text.
- **Frozen direction** — a serialized character-feature vector fitted offline for one output label.
- **Selection score** — the uncalibrated mixture of deterministic evidence and a frozen-direction score. It is used for ranking and is not a probability.
- **Pruner** — beam search that selects at most one non-overlapping candidate per output label while rewarding location coherence and common ordering.
- **Validator** — deterministic final referee for offsets, normalization, minimum score, and complete administrative tuple consistency. It never invents candidates.
- **Resource artifact** — immutable browser input containing feature configuration, scoring configuration, frozen directions, gazetteer tuples, provenance, and checksums.
- **Dataset family** — records produced for one construction objective, such as general construction or name robustness. Benchmark reports keep family results separate.

## Invariants

1. Source offsets are UTF-16 offsets and must reproduce the candidate text exactly.
2. The public output schema remains NAME, PHONE, ADDRESS_DETAIL, SUBDISTRICT, DISTRICT, PROVINCE, and POSTCODE.
3. Bare `เมือง` is not a district unless province-compatible administrative or sequence context resolves it.
4. Location-tuple-held-out evaluation remains mandatory.
5. Frozen directions are promoted only when they beat `noDirections` without regressing protected address slices.
6. Public fixtures and reports contain only synthetic, consented, or de-identified records. Private-list reports are aggregate-only.

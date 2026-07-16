# ADR-0003: Use a sparse residual ranker for candidate selection

- Status: Accepted
- Date: 2026-07-16

## Context

The first latent implementation averaged dense character vectors and mixed the
result into deterministic evidence with a fixed weight. It was fast, but it did
not optimize the actual decision between candidates, could overwhelm strong
evidence, and could not represent candidate source, boundary, marker, or
evidence-rule context. Several fits lost to the evidence-only ablation.

The dataset loader also discarded generator-declared split and template-family
provenance. A location-only split therefore allowed template leakage. For
`NAME` and `ADDRESS_DETAIL`, some expected values performed typo correction,
abbreviation expansion, or spacing rewrites that a span selector cannot emit.

## Decision

Keep the vector architecture and deepen its Interface:

- `candidate-hash-v3` creates a sparse hashed vector from span n-grams, nearby
  context, boundaries, shape, line position, Candidate source, Evidence rule
  IDs, and distances to useful markers.
- Offline fitting performs pairwise logistic updates between the source-aligned
  gold candidate and hard candidates produced by the real Candidate Engine.
  Absent fields include an explicit `NULL` choice.
- The runtime score is the evidence logit plus a bounded learned residual. A
  missing direction or zero per-label scale is exactly evidence-only.
- The promoted resource enables the residual for `NAME`. `ADDRESS_DETAIL`
  remains evidence-only because positive residual scales regressed the private
  acceptance benchmark despite improving synthetic development data.
- Resource promotion must pass both leakage-safe development and evaluation
  ablations, protected slices, and the private aggregate regression gate.
- Candidate selection uses surface-normalized source-span gold. Desired text
  rewrites remain separate normalization gold.

## Consequences

The Latent Module stays small, local, browser-compatible, and much faster than a
Transformer Implementation. The frozen NAME direction adds roughly 108 KiB
gzip to the resource. On the recorded runs it improved exact-record accuracy by
7.7 percentage points on development and 2.3 points on evaluation, preserved
the 56/58 private gate, and added about 0.40 ms to synthetic p95 latency.

This decision does not claim that synthetic accuracy transfers to production.
Improving address selection next requires reviewed real-world ambiguity and
absence examples. The evidence-only Adapter remains available as a complete
ablation and safe fallback.

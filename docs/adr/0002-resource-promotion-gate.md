# ADR-0002: Gate frozen-resource promotion against noDirections

- Status: Accepted
- Date: 2026-07-16

## Context

Gold-span centroid fitting and naive dataset concatenation can improve one field while reducing exact-record or address accuracy. Selection scores are not calibrated probabilities.

## Decision

Every frozen-direction experiment must report `noDirections` on the identical candidate, pruning, validation, and split configuration. Reports include candidate reachability, selection, acceptance, dataset-family slices, case-type slices, timing, and accepted-span calibration.

Resource construction supports equal-family weighting, `OTHER` negatives, and candidate-contrastive fitting. These are experimental build choices, not automatic runtime promotion.
It also supports `fit-mode=none`, which produces the deterministic baseline
without frozen directions.

`bun run build:resources` refuses to write a resource that loses its `noDirections`
ablation and exits non-zero, unless `--skip-gate` is passed to write an explicitly
unpromoted experiment artifact instead. Every written artifact records a
`promotionGate` field (`enforced`, `passed`, `ablationApplicable`, `failures`,
`report`). Under `fit-mode=none` the built resource has no frozen directions, so
it is identical to its own `noDirections` comparison parser and `passed` is
trivially true; `ablationApplicable: false` marks that case so `passed: true`
is never misread as a demonstrated win over the baseline. `bun run
check:resource-gate` (`scripts/check-resource-gate.ts`) scans `src/` and `bench/`
for `resources/generated/*.json` references and fails CI if any shipped resource
lacks a `promotionGate`, has `enforced: false`, has `passed: false`, or is marked
as grandfathered. The Pages workflow runs this check before building the library
and demo.

## Consequences

- A resource that loses to `noDirections` is retained only as an experiment artifact.
- Location-tuple-held-out evaluation remains the primary synthetic split; template-family and reviewed-gold slices are separate readouts.
- Resource checksums depend on contents and build configuration rather than local absolute paths.
- The compatibility field named `confidence` is documented as an uncalibrated selection score until a calibrated resource schema is introduced.
- Pre-gate resources cannot ship; they must be rebuilt and pass the current gate.

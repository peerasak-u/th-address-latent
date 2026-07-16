# ADR-0002: Gate frozen-resource promotion against evidence-only

- Status: Accepted
- Date: 2026-07-16

## Context

Gold-span centroid fitting and naive dataset concatenation can improve one field while reducing exact-record or address accuracy. Selection scores are not calibrated probabilities.

## Decision

Every frozen-direction experiment must report an evidence-only ablation on the
identical Candidate Engine, Pruner, Validator, and partition configuration.
Reports include candidate reachability, selection, acceptance, dataset-family
slices, case-type slices, timing, and accepted-span calibration.

Resource construction supports equal-family weighting, `OTHER` negatives, and candidate-contrastive fitting. These are experimental build choices, not automatic runtime promotion.
It also supports `fit-mode=none`, which produces the deterministic baseline
without frozen directions.

`bun run build:resources` evaluates both development and evaluation partitions
and refuses to write a resource that loses either evidence-only ablation. It
exits non-zero unless `--skip-gate` is passed to write an explicitly unpromoted
experiment artifact instead. `--skip-gate` still refuses to overwrite the
default shipped output path (`resources/generated/construction-v3-residual-name-d2048.json`);
an unpromoted build must target an explicit non-shipped `--output` path. The
gate also fails if no dataset slice reaches `MIN_SLICE_RECORDS`, since that
means the evidence-only ablation never ran a comparison. Every written artifact
records a `promotionGate` field (`enforced`, `passed`, `ablationApplicable`,
`failures`, `developmentReport`, `report`). Under `fit-mode=none` the built
resource has no frozen directions, so it is identical to its own evidence-only
comparison and `passed` is trivially true; `ablationApplicable: false` marks
that case so `passed: true` is never misread as a demonstrated win over the
baseline. `bun run check:resource-gate` (`scripts/check-resource-gate.ts`)
scans `src/` and `bench/` for `resources/generated/*.json` references and fails
CI if any shipped resource lacks a `promotionGate`, has `enforced: false`, has
`passed: false`, is marked as grandfathered, or declares a nonzero
`residualScaleByLabel` for any label other than `NAME` (see ADR-0003). The
Pages workflow runs this check before building the library and demo, on every
push to `main` and on pull requests; only a push to `main` runs the deploy job.

## Consequences

- A resource that loses to evidence-only is retained only as an experiment artifact.
- Complete location tuples never cross partitions, and generator-declared evaluation template families are held out from fitting and tuning. Incompatible records are explicitly excluded.
- Development guides bounded tuning; evaluation remains untouched until promotion. The private aggregate list is an additional regression gate.
- Resource checksums depend on contents and build configuration rather than local absolute paths.
- The compatibility field named `confidence` is documented as an uncalibrated selection score until a calibrated resource schema is introduced.
- Pre-gate resources cannot ship; they must be rebuilt and pass the current gate.

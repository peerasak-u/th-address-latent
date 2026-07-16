# ADR-0002: Gate frozen-resource promotion against noDirections

- Status: Accepted
- Date: 2026-07-16

## Context

Gold-span centroid fitting and naive dataset concatenation can improve one field while reducing exact-record or address accuracy. Selection scores are not calibrated probabilities.

## Decision

Every frozen-direction experiment must report `noDirections` on the identical candidate, pruning, validation, and split configuration. Reports include candidate reachability, selection, acceptance, dataset-family slices, case-type slices, timing, and accepted-span calibration.

Resource construction supports equal-family weighting, `OTHER` negatives, and candidate-contrastive fitting. These are experimental build choices, not automatic runtime promotion.

## Consequences

- A resource that loses to `noDirections` is retained only as an experiment artifact.
- Location-tuple-held-out evaluation remains the primary synthetic split; template-family and reviewed-gold slices are separate readouts.
- Resource checksums depend on contents and build configuration rather than local absolute paths.
- The compatibility field named `confidence` is documented as an uncalibrated selection score until a calibrated resource schema is introduced.

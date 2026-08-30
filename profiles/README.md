# Model profile descriptors

The JSON files in this directory describe the customer-visible model artifacts and operating choices supported by the current release pipeline.

A profile records:

- Stable profile and model identity.
- Required model filenames, byte lengths, and structural compatibility data.
- Supported engine-version range.
- Default, qualified, experimental, and qualification-pending context choices.
- Hardware memory class and any manual system prerequisite.
- Customer-selectable expert options.
- Product limitations that must be shown before launch.

Profiles are versioned and packaged with the proprietary engine sidecar. The open-source TUI reads their customer-facing fields to discover models and render configuration choices; the proprietary sidecar owns the final launch policy.

## Internal policy fields

Legacy configuration code may still use `verified`, `custom`, and `unprofiled`
internally to preserve launcher policy compatibility. These are not the primary
TUI vocabulary; users see Recommended, Ready, Download, Local, Needs attention,
and Running.

Experimental and qualification-pending choices must remain visibly distinct.
Qualification status never blocks a configured context choice: untested contexts
remain selectable with an explicit warning and no compatibility, memory,
correctness, quality, or performance claim. The TUI must never silently convert
evidence depths into a product qualification claim.

## Inspection

Normal discovery and launch use filenames, byte lengths, index/config metadata,
shard coverage, and engine format checks without hashing model contents. Missing,
truncated, ambiguous, or incompatible artifacts are startup errors. Release and
private qualification tooling may retain digests, but the shipping launcher does
not use those digest fields for user model files. Inspection does not grant model
rights or establish that untrusted weights are safe.

Model paths are supplied by the user and are never hard-coded in a profile.

# Model profile descriptors

The JSON files in this directory describe the customer-visible model artifacts and operating choices supported by the current release pipeline.

A profile records:

- Stable profile and model identity.
- Required model filenames and file verification data.
- Supported engine-version range.
- Default, qualified, experimental, and qualification-pending context choices.
- Hardware memory class and any manual system prerequisite.
- Customer-selectable expert options.
- Product limitations that must be shown before launch.

Profiles are versioned and packaged with the proprietary engine sidecar. The open-source TUI reads their customer-facing fields to discover models and render configuration choices; the proprietary sidecar owns the final launch policy.

## Runtime labels

- `verified` — model identity and selected settings match the packaged profile.
- `custom` — a recognized profile is running with an allowed operator deviation.
- `best-effort` — the engine is running outside a packaged profile.

Experimental and qualification-pending choices must remain visibly distinct.
Qualification status never blocks a configured context choice: untested contexts
remain selectable with an explicit warning and no compatibility, memory,
correctness, quality, or performance claim. The TUI must never silently convert
evidence depths into a verified product claim.

## Verification

Profile-matched files are verified before a verified launch. A missing shard, unexpected size, or checksum mismatch is a startup error. Verification confirms artifact identity only; it does not grant rights to the model or establish that untrusted weights are safe.

Model paths are supplied by the user and are never hard-coded in a profile.

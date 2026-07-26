# Prototype status

This directory is the immutable, reference-only source snapshot associated with shared Setup Universe production release `20260726T002235Z-478235af2650`.

For **PicSetup**, https://picsetup.com/ was verified against that release on 2026-07-26; current availability must be checked live. The local preview route is `/?setup=pic`.

The snapshot is intentionally not split into a domain-specific architecture: that production release serves one common static runtime and resolves the active setup from the hostname. The root [AGENTS.md](../AGENTS.md) is authoritative: future PicSetup work starts from a new design outside this snapshot.

Do not extend or rewrite this directory as the future product. Moving, archiving, or removing it requires explicit user authorization after a successor has been accepted and the snapshot's provenance is retained.

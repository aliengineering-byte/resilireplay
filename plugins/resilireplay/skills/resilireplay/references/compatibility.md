# Compatibility evidence levels

- LIVE VERIFIED: a real client emitted the event and the generated regression passed.
- FIXTURE VERIFIED: official payload-shaped fixtures passed the adapter and security suite.
- INSTALLATION VERIFIED: isolated installation/configuration validation passed, without a live model flow.
- DOCUMENTED ONLY: instructions exist but have not passed this release's runtime gates.
- UNSUPPORTED: the integration is intentionally unavailable or incompatible.

Do not promote an evidence level without a public or release-recorded test result.

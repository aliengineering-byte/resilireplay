# Reviewed fault campaigns

Fault injection belongs only in an explicit ResiliReplay campaign. Validate first and show the campaign SHA-256. Tool calls require the exact hash through `--confirm-tools`; remote targets require `--allow-remote`. Use allowlists and safe fixture arguments. Never translate passive capture into an automatic retry or campaign.

Typical sequence:

```text
resilireplay campaign validate campaign.yml
resilireplay campaign run campaign.yml --confirm-tools <exact-sha256>
resilireplay campaign compare <run> --baseline <approved-baseline>
```

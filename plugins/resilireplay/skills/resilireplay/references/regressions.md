# Regression generation

`resilireplay capture generate-test` turns the last supported failure evidence into a Node test plus a pinned evidence JSON file. It validates the public schema, evidence ID, normalized error class, and deterministic flag. The generated test proves the evidence contract remains executable; it does not rerun the original side effect or reconstruct private inputs.

Review generated files before committing them. Share only synthetic or explicitly approved evidence.

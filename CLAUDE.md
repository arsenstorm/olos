# OLOS Agent Guidance

Follow [AGENTS.md](./AGENTS.md) for repository code standards, formatting, and
automation guidance.

Project-specific priorities:

- keep the root `olos` import minimal
- prefer explicit subpath exports such as `olos/core`
- avoid barrel files
- keep provider-specific code out of core protocol modules
- preserve the npm package contract in `olos/package.json`

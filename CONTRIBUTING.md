# Contributing to OLOS

Thanks for your interest in contributing to OLOS.

Before opening a pull request:

- search [existing issues](https://github.com/arsenstorm/olos/issues) and
  [pull requests](https://github.com/arsenstorm/olos/pulls) so work does not
  duplicate an existing thread
- read [AGENTS.md](./AGENTS.md) for repository code standards and automation
  guidance
- do not report security vulnerabilities in public issues or pull requests; see
  [SECURITY.md](./SECURITY.md)

## Development

Install dependencies from the repository root:

```bash
bun install
```

Useful commands:

```bash
bun run check
bun run check-types
bun run test
bun run build
```

## Repository

- [Pull request descriptions](./contributing/repository/pull-request-descriptions.md)
- [Testing](./contributing/core/testing.md)

## Templates

- [Pull request template](./.github/PULL_REQUEST_TEMPLATE.md)
- [Bug report](./.github/ISSUE_TEMPLATE/bug-report.yml)
- [Feature request](./.github/ISSUE_TEMPLATE/feature-request.yml)

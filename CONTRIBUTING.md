# Contributing

Thank you for helping improve Stam.

## Development

Stam requires Bun 1.4.0, Typst 0.15.1, Poppler `pdftotext`, and Liberation
fonts. Follow the setup instructions in `README.md`, and keep changes focused
and reviewable.

Frontend changes must follow `docs/design-system.md`. Domain and persistence
changes should preserve exact decimal arithmetic, immutable event history, and
the distinction between effective and knowledge time.

Never commit credentials, databases, company exports, or real personal data.
Tests and examples must use clearly fictional identities and identifiers.

## Verification

Run the complete verification set before opening a pull request:

```bash
bun test
bun run typecheck
bun run lint
bun run build
```

Update tests and documentation with behavioral changes. Explain any check that
cannot be run in the pull request description.

## Licensing

By contributing, you agree that your contribution is licensed under the GNU
Affero General Public License, version 3 or later.

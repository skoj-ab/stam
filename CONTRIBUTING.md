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
Swedish personal-number fixtures use Skatteverket's published, blocked
[test personnummer](https://www.skatteverket.se/omoss/digitalasamarbeten/omvaraoppnadata/testpersonnummersomoppendata.4.5b35a6251761e6914202df9.html),
which will never be assigned to real people. Synthetic organization numbers use
the Luhn-valid `550000-00xx` range: its third digit is below the minimum `2`
used for assigned organization numbers, so it cannot identify a legal entity.

## Verification

Run the complete verification set before opening a pull request:

```bash
bun test
bun run typecheck
bun run lint
bun run audit
bun run build
```

Update tests and documentation with behavioral changes. Explain any check that
cannot be run in the pull request description.

## Licensing

By contributing, you agree that your contribution is licensed under the GNU
Affero General Public License, version 3 or later.

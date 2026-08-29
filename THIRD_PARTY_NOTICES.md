# Third-party notices

Stam is distributed with separately licensed dependencies and assets. Their
licenses are not replaced by Stam's AGPL license.

## Open Cap Format

The production build includes the Open Cap Format v1.2.0 JSON schemas from the
[Open Cap Table Coalition](https://github.com/Open-Cap-Table-Coalition/Open-Cap-Format-OCF).
Each schema retains its original copyright and source URL. The applicable schema
and documentation license is reproduced in `licenses/OCF-LICENSE.md`.

## Fonts

The web application embeds Inter and Source Serif 4 through Fontsource. They are
licensed under the SIL Open Font License 1.1; the copyright notices and license
texts are reproduced in `licenses/Inter-OFL.txt` and
`licenses/Source-Serif-4-OFL.txt`.

The container also installs Liberation fonts from Debian for PDF generation.
Its package copyright information remains available under `/usr/share/doc` in
the container.

## JavaScript dependencies

The production server and browser artifacts bundle code from packages recorded
in `bun.lock`; runtime `node_modules` is not included. Their package metadata,
copyright notices, license texts, and required notice files are consolidated at
build time in `dist/licenses/JS-DEPENDENCIES.md`. The container installs that
file as `/usr/share/licenses/stam/third-party/JS-DEPENDENCIES.md`.

Run `bun run licenses:generate` after installing dependencies to regenerate and
validate the file. `bun run build` runs this step automatically.

## Typst

The container includes Typst 0.15.1. The `LICENSE` and `NOTICE` files from the
same checksum-verified release archive are installed under
`/usr/share/licenses/typst/`.

## Bun

The container uses Bun 1.4.0. Bun's upstream license and linked-component
information is reproduced in `licenses/Bun-1.4.0-LICENSE.md` and installed
under `/usr/share/licenses/stam/third-party/`.

## Debian packages

Poppler utilities, Liberation fonts, and their shared-library dependencies are
installed as Debian packages. Debian's package copyright and license records
remain available under `/usr/share/doc`, including:

- `/usr/share/doc/poppler-utils/copyright`
- `/usr/share/doc/libpoppler147/copyright`
- `/usr/share/doc/fonts-liberation/copyright`

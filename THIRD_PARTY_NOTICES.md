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

## Runtime and build dependencies

Stam uses other open-source packages recorded in `bun.lock`, and includes Typst
and Poppler in its container image. Run `bun pm licenses --prod` after installing
dependencies for the current package-license inventory. Package source and
license information is available from the package metadata and upstream
projects.

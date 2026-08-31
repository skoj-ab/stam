# Releasing

Stam publishes multi-platform container images to
`ghcr.io/skoj-ab/stam`. The CI workflow is the only supported publisher.

## Edge images

Every successful push to `main` publishes:

- `edge`, which moves with `main` and is intended for evaluation.
- `sha-<short-commit>`, which identifies the exact source revision.

The workflow verifies the application, builds and smoke-tests the runtime image,
scans it for fixed high or critical vulnerabilities, and then publishes amd64 and arm64
manifests. The registry artifact includes BuildKit SBOM and provenance
attestations plus a GitHub build-provenance attestation. The package is set to
public after publication.

## Version releases

1. Ensure `main` is green and the intended migration and operational changes
   are documented.
2. Set `package.json` to the release version and commit it normally.
3. Create an annotated `vMAJOR.MINOR.PATCH` tag at that commit.
4. Push the tag without moving or replacing an existing version tag.
5. Wait for the complete CI workflow to pass.
6. Verify an anonymous pull of `ghcr.io/skoj-ab/stam:MAJOR.MINOR.PATCH` on both
   supported architectures.
7. Create the GitHub release and include migration, backup, and rollback notes.

Version tags publish the exact `MAJOR.MINOR.PATCH` image and a commit tag. The
workflow deliberately does not publish `latest` while Stam is pre-1.0. Published
version tags are immutable release artifacts and must never be overwritten.

## Verification

Inspect the image digest and attestations before announcing the release:

```bash
docker buildx imagetools inspect ghcr.io/skoj-ab/stam:MAJOR.MINOR.PATCH
gh attestation verify oci://ghcr.io/skoj-ab/stam:MAJOR.MINOR.PATCH \
  --repo skoj-ab/stam
```

Record the digest in release notes. Operators should deploy exact version tags
or digests and create a verified off-host database backup before upgrading.

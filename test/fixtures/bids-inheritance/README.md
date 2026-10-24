# Synthetic ASL inheritance fixture

Non-patient, CC0 data. Each NIfTI-1 image contains 32 synthetic uint8 voxels:
2 × 2 × 2 spatial samples, four volumes, 3 mm isotropic voxels and 4.5 s TR.
Headers include millimetre/second units and an identity-oriented spatial transform.
Each uncompressed file is 384 bytes (352-byte header/extension area + 32 bytes).

| Acquisition     | PLD (s) | Labeling duration (s) | TE (s) | Selected context            |
| --------------- | ------- | --------------------- | ------ | --------------------------- |
| sub-01 / ses-01 | 2.1     | 1.6                   | 0.012  | label,control,label,control |
| sub-02 / ses-01 | 1.8     | 1.8                   | 0.014  | control,label,control,label |

Root metadata provide Siemens, 3 T, 3D PCASL, absent M0, no background suppression,
two acquired pairs and preparation TR 4.5 s. Subject 01 overrides PLD to 1.9 s
and labeling duration; session 01 overrides PLD to 2.0 s and TE; image-directory
JSON overrides PLD to 2.1 s. Its context replaces the root sequence, not its rows.
Subject 02 has no adjacent JSON or context and uses only root metadata.

Native command tests assert these expected values independently of validation.
Official conformance commands live in `tools/bids-conformance/README.md`.
This fixture establishes neither scientific processing quality nor engine support.

# Map label fonts

MapLibre cannot render any text without signed-distance-field glyphs served as
protobuf ranges. There is no free public glyph server, so these are self-hosted.

**Source:** [openmaptiles/fonts](https://github.com/openmaptiles/fonts) v2.0,
`noto-sans.zip`. Noto Sans is licensed under the SIL Open Font License 1.1.

**Why only `0-255.pbf`:** that range is Basic Latin and Latin-1 Supplement —
every character in an airport identifier, a callsign, an altitude, or a runway
designator. The full pack covering all Unicode ranges is 60 MB; these two files
are 156 KB.

**Why Noto Sans rather than Geist**, which the rest of the interface uses:
building glyphs from an arbitrary font requires `fontnik`, which is a native
module and a build toolchain. Map labels are small technical text where the
difference is not perceptible, and that is not worth a native dependency.

To regenerate, download the release zip and extract the two `0-255.pbf` files
into directories named after their font stacks — MapLibre resolves them by the
`text-font` value in the style, so the directory names must match exactly.

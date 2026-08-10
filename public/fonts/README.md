# Map label fonts

MapLibre cannot render any text without signed-distance-field glyphs served as
protobuf ranges. There is no free public glyph server, so these are self-hosted.

**Source:** [openmaptiles/fonts](https://github.com/openmaptiles/fonts) v2.0,
`noto-sans.zip`. Noto Sans is licensed under the SIL Open Font License 1.1.

**Which ranges:** `0-255` is Basic Latin and Latin-1 Supplement — every
character in an airport identifier, a callsign, an altitude, or a runway
designator. `8448-8703` is Arrows, carried by Noto Sans Bold alone, and it
exists for exactly two glyphs: the climb and descent arrows in a target's data
block. The full pack covering all Unicode ranges is 60 MB; these files are a
fraction of it.

A glyph outside a hosted range does not fall back — it renders as nothing. So a
new symbol in a label means checking which range it lives in first.

**Why Noto Sans rather than Geist**, which the rest of the interface uses:
building glyphs from an arbitrary font requires `fontnik`, which is a native
module and a build toolchain. Map labels are small technical text where the
difference is not perceptible, and that is not worth a native dependency.

To regenerate, download the release zip and extract the ranges above into
directories named after their font stacks — MapLibre resolves them by the
`text-font` value in the style, so the directory names must match exactly.

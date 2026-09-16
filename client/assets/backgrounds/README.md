# System background art

The main tactical map currently uses two cached WebP backgrounds:

| Runtime asset | Source art | Dimensions | File size |
| --- | --- | --- | ---: |
| `systems/open-space.webp` | `art_src/backgrounds/open-space.png` | 1672 × 941 | 32,600 bytes |
| `systems/nebula.webp` | `art_src/backgrounds/nebula.png` | 1672 × 941 | 61,922 bytes |

`client/render/system-background.js` selects the family from the public sector archetype, cover-fits the image, and caches the rendered layer by family and canvas size. `asteroid-heavy` currently falls back to `open-space` because a dedicated asteroid image was not available in the generation pass. A future asteroid background should use the same 1672 × 941 source target, restrained contrast, and object-independent composition.

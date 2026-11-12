# WalkMyCode brand

A warm, dark lecture hall: chalk on a green board, and one small light that walks the map.
The product's in-app name is still *Lantern* until the rename; everything public says **WalkMyCode**.

## Files

| File | Use |
|---|---|
| `walkmycode-avatar-1000.png` / `-500.png` | GitHub org avatar, social avatars |
| `walkmycode-mark.svg`, `walkmycode-mark-transparent.svg` | The mark (the light above the five lanes), on the wall colour or transparent |
| `walkmycode-wordmark.svg` | "WalkMyCode" in chalk with the light: transparent, for dark backgrounds only |
| `walkmycode-wordmark-on-dark.svg` / `.png` | The wordmark on its own dark plate, safe on light pages |
| `walkmycode-readme-banner.svg` / `.png` | README header, 1600×400 |
| `walkmycode-social-preview.svg` / `.png` | GitHub repo social preview, 1280×640 |
| `favicon.svg`, `favicon-16.png`, `favicon-32.png`, `apple-touch-icon-180.png`, `icon-512.png` | Site and app icons |
| `src/build_brand.py` | Rebuilds everything. Lettering is converted to outlines, so the SVGs need no fonts |

## Colour

| Token | Hex | Use |
|---|---|---|
| Wall | `#23201c` | Background |
| Raised | `#2d2924` | Raised surfaces |
| Panel | `#2e2a25` / `#3a352e` | Cards, panels |
| Line | `#4a443c` | Rules, borders |
| **Glow** | **`#f3d77a`** | The light, the one accent. Primary buttons, links, underline |
| Ink on glow | `#2a2112` | Text on glow |
| Board | `#1f3a31` / `#244437` | Chalkboard surfaces |
| Wood | `#6b4a2b` / `#4d3420` | Board frame |
| Chalk | `#f1efe6` | Main text, wordmark |
| Dim | `#b8ae9c` | Secondary text |

**Lanes**, the map's columns. Use them together, always in this order: pages `#9fd3f0` · API `#f3d77a` · logic `#e0c9a6` · data `#a8e0a0` · outside services `#f2a7a0`. Messages: `#c9a8e0`.

## Type

- **Caveat** (bold): the wordmark and hand-lettered titles.
- **Kalam**: chalk handwriting, for notes on the board.
- **Inter**: interface and body text.
- **JetBrains Mono**: code and file:line references.

All four are free on Google Fonts.

## The light

A small glowing dot with a soft halo. It is the guide: it sits at the end of the wordmark and travels along the map's arrows.
- Use only one light per picture. It always marks where you are, or where you're going next.
- Draw the path it travels as a dashed glow line (round caps, short dashes).

## Words

- **Line:** Find your way around the code you generated.
- **Short:** Walk through any codebase: a map, guided tours and a voice that explains.
- **Voice:** plain, patient, beginner-first. Explain like a good lecturer, never show off. No hype.

## Don'ts

- Don't recolour the light or the lanes, or put the chalk wordmark on a light background. Use the on-dark version instead.
- Don't add a second accent colour.
- Don't set the wordmark in any other font.

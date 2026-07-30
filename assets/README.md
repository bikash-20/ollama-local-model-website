# Assets

Icons and other static assets referenced by `index.html` (formerly `ollama-chat.html`) and
`manifest.webmanifest`.

## Files

| File | Purpose | Used by |
|------|---------|---------|
| `icon.svg` | Master icon — moon glyph on aurora gradient | SVG favicon (modern browsers) |
| `icon-192.png` | 192x192 PNG export | manifest, `<link rel="icon">` |
| `icon-512.png` | 512x512 PNG export | manifest, install splash |
| `icon-maskable.svg` | Maskable variant — moon centred inside the 80% safe zone | Android adaptive icon source |
| `icon-maskable-192.png` | 192x192 maskable | manifest, Android home screen |
| `icon-maskable-512.png` | 512x512 maskable | manifest, Android splash |
| `apple-touch-icon.png` | 180x180 for iOS home screen | `<link rel="apple-touch-icon">` |
| `favicon-16.png` | 16x16 browser tab | `<link rel="icon" sizes="16x16">` |
| `favicon-32.png` | 32x32 browser tab | `<link rel="icon" sizes="32x32">` |
| `favicon.svg` | Vector favicon for modern browsers | `<link rel="icon" type="image/svg+xml">` |

## Design

- Background: aurora gradient (`#7c9cff` → `#b98cff` → `#5eead4`) that
  matches the `--aurora-*` CSS variables used throughout the app.
- Foreground: a dark crescent moon (Nocta = "of the night") with a soft
  highlight and a few sparkle stars.
- The maskable variant keeps the moon inside the central 80% circle so
  nothing important is ever cropped by Android's launcher masks.

## Re-rendering

The PNGs were rasterised from the SVGs with `cairosvg`. To re-export at
new sizes, drop a short Python script in this folder that loops over
sizes, calls `cairosvg.svg2png`, and saves with `Pillow.optimize=True`.

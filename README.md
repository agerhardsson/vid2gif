# vid2gif

Convert video to optimized GIFs. Interactive and CLI modes.

## Install

```sh
npm install -g vid2gif
```

Or run without installing:

```sh
npx vid2gif
```

## Usage

### Interactive mode (no arguments)

```sh
vid2gif
```

Guides you through file selection, resolution, motion level, colors, cropping, frame optimization, clipping, and file size limits.

### Non-interactive mode

```sh
vid2gif input.mp4 output.gif
```

### Options

| Flag | Default | Description |
|---|---|---|
| `--res` | `0.75` | Resolution as % of original (0.0–2.0) |
| `--motion` | `medium` | `low` (10fps), `medium` (15fps), `high` (24fps) |
| `-f, --fps` | — | Override frames per second |
| `--colors` | `256` | Max palette colors |
| `--no-crop` | — | Disable auto border cropping |
| `--no-frame-opt` | — | Disable frame optimization |
| `--start` | — | Clip start time (seconds) |
| `--duration` | — | Clip duration (seconds) |
| `--max-size` | — | Target GIF size in MB |

### Examples

```sh
vid2gif video.mp4 out.gif
vid2gif video.mp4 out.gif --res 0.5 --motion low
vid2gif video.mp4 out.gif --start 5 --duration 3 --max-size 5
vid2gif video.mp4 out.gif --no-crop --no-frame-opt
```

## Pipeline

```
[cropdetect] → [mpdecimate] → fps → scale → palettegen/paletteuse
```

- **Auto crop** — detects and removes letterbox/borders
- **Frame optimization** — drops near-duplicate frames
- **Palette generation** — `stats_mode=diff` for motion-aware colors
- **Dithering** — `sierra2_4a` with `diff_mode=rectangle` for smooth gradients
- **Size targeting** — iterative sqrt-based resolution reduction

## Requirements

- [ffmpeg](https://ffmpeg.org/) (must be installed and on PATH)
- Node.js 18+

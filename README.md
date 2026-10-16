# vid2gif

Convert video, static SVG, animated SVG, and folders of PNG frames to optimized GIFs. Interactive and CLI modes.

## Install

### From this repo

```sh
npm install
npm install -g .
```

Or during development:

```sh
npm install
npm link
```

### From npm

```sh
npm install -g vid2gif
```

Note: the public npm package name `vid2gif` is already used by an unrelated package with no CLI binary. If you are working from this repository, use `npm install -g .`, `npm link`, or run it locally with `npx vid2gif` from the repo root.

Or run without installing:

```sh
npx vid2gif
```

## Usage

### Interactive mode (no arguments)

```sh
vid2gif
```

Guides you through input path selection, resolution, motion level, colors, and file size limits. The input can be a video, SVG, or a folder of PNG frames. For video inputs it also supports cropping, frame optimization, and clipping.

### Non-interactive mode

```sh
vid2gif input.mp4 output.gif
vid2gif artwork.svg artwork.gif
vid2gif frames/ animation.gif
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
| `--start` | — | Clip start time, or animated SVG capture start offset (seconds) |
| `--duration` | — | Clip duration, or animated SVG capture duration (seconds) |
| `--max-size` | — | Target GIF size in MB |

### Examples

```sh
vid2gif video.mp4 out.gif
vid2gif video.mp4 out.gif --res 0.5 --motion low
vid2gif video.mp4 out.gif --start 5 --duration 3 --max-size 5
vid2gif video.mp4 out.gif --no-crop --no-frame-opt
vid2gif artwork.svg out.gif --res 1 --colors 128
vid2gif git_flow.drawio.svg git_flow.gif --motion low
vid2gif frames/ animation.gif --fps 12
```

PNG frames are read directly from the folder in natural filename order (for example, `frame2.png` comes before `frame10.png`).

## Pipeline

```
[cropdetect] → [mpdecimate] → fps → scale → palettegen/paletteuse
```

Animated SVGs are rendered in a headless browser, captured as frame sequences, and then encoded through the same GIF palette pipeline.

- **Auto crop** — detects and removes letterbox/borders
- **Frame optimization** — drops near-duplicate frames
- **Palette generation** — `stats_mode=diff` for motion-aware colors
- **Dithering** — `sierra2_4a` with `diff_mode=rectangle` for smooth gradients
- **Size targeting** — iterative sqrt-based resolution reduction
- **Animated SVG support** — browser-rendered frame capture preserves CSS/SVG animation timelines

## Requirements

- [ffmpeg](https://ffmpeg.org/) (must be installed and on PATH)
- Node.js 18+
- Installing dependencies downloads a bundled Chromium browser via Puppeteer for animated SVG rendering

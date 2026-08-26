import * as p from "@clack/prompts";
import fs from "fs";

const RES_PRESETS = [
  { value: 1.0, label: "100% (original size)" },
  { value: 0.75, label: "75% (recommended)" },
  { value: 0.5, label: "50%" },
  { value: 0.35, label: "35%" },
  { value: 0.25, label: "25%" },
  { value: null, label: "Custom %" },
];

const MOTION_PRESETS = [
  { value: 10, label: "Low (10 fps) — smallest files" },
  { value: 15, label: "Medium (15 fps) — good balance" },
  { value: 24, label: "High (24 fps) — smooth motion" },
  { value: null, label: "Custom fps" },
];

const COLOR_PRESETS = [
  { value: 256, label: "256 (best quality)" },
  { value: 128, label: "128 (smaller files)" },
  { value: null, label: "Custom" },
];

function isSvgInputPath(filePath) {
  return filePath?.toLowerCase().endsWith(".svg");
}

function normalizeUserPath(value) {
  if (typeof value !== "string") return value;

  const trimmed = value.trim();
  const quoted = trimmed.match(/^(["'])(.*)\1$/);

  return quoted ? quoted[2].trim() : trimmed;
}

export async function runInteractive() {
  p.intro("vid2gif");

  const opts = await p.group(
    {
      input: () =>
        p.text({
          message: "Input video or SVG file",
          placeholder: "path/to/video.mp4 or image.svg",
          validate: (v) => {
            const normalized = normalizeUserPath(v);
            if (!normalized) return "Required";
            if (!fs.existsSync(normalized)) return "File not found";
          },
        }),

      output: ({ results }) =>
        p.text({
          message: "Output GIF file",
          placeholder: results.input
            ? normalizeUserPath(results.input).replace(/\.[^.]+$/, ".gif")
            : "output.gif",
          initialValue: results.input
            ? normalizeUserPath(results.input).replace(/\.[^.]+$/, ".gif")
            : "output.gif",
        }),

      res: () =>
        p.select({
          message: "Resolution (% of original)",
          options: RES_PRESETS,
        }),

      customRes: ({ results }) => {
        if (results.res !== null) return;
        return p.text({
          message: "Custom resolution %",
          placeholder: "75",
          validate: (v) => {
            const n = Number(v);
            if (!v || isNaN(n) || n < 1 || n > 200)
              return "Enter a number between 1 and 200";
          },
        });
      },

      motion: () =>
        p.select({
          message: "Motion level",
          options: MOTION_PRESETS,
        }),

      customFps: ({ results }) => {
        if (results.motion !== null) return;
        return p.text({
          message: "Custom frame rate",
          placeholder: "15",
          validate: (v) => {
            const n = Number(v);
            if (!v || isNaN(n) || n < 1 || n > 60)
              return "Enter fps between 1 and 60";
          },
        });
      },

      colors: () =>
        p.select({
          message: "Palette colors",
          options: COLOR_PRESETS,
        }),

      customColors: ({ results }) => {
        if (results.colors !== null) return;
        return p.text({
          message: "Custom colors",
          placeholder: "256",
          validate: (v) => {
            const n = Number(v);
            if (!v || isNaN(n) || n < 2 || n > 256)
              return "Enter between 2 and 256";
          },
        });
      },

      autoCrop: ({ results }) =>
        isSvgInputPath(normalizeUserPath(results.input))
          ? undefined
          : p.confirm({
              message: "Auto-crop empty borders?",
              initialValue: true,
            }),

      optimizeFrames: ({ results }) =>
        isSvgInputPath(normalizeUserPath(results.input))
          ? undefined
          : p.confirm({
              message: "Optimize frames? (drops near-duplicate frames)",
              initialValue: true,
            }),

      clip: ({ results }) =>
        isSvgInputPath(normalizeUserPath(results.input))
          ? undefined
          : p.confirm({
              message: "Clip a section?",
              initialValue: false,
            }),

      start: ({ results }) => {
        if (!results.clip) return;
        return p.text({
          message: "Start time (seconds)",
          placeholder: "0",
          validate: (v) => {
            if (!v) return "Required";
            if (isNaN(Number(v))) return "Enter a number";
          },
        });
      },

      duration: ({ results }) => {
        if (!results.clip) return;
        return p.text({
          message: "Duration (seconds)",
          placeholder: "10",
          validate: (v) => {
            if (!v) return "Required";
            if (isNaN(Number(v))) return "Enter a number";
          },
        });
      },

      maxSize: () =>
        p.text({
          message: "Max file size in MB (optional)",
          placeholder: "skip",
          validate: (v) => {
            if (!v) return;
            if (isNaN(Number(v)) || Number(v) <= 0)
              return "Enter a valid size";
          },
        }),
    },
    {
      onCancel: () => {
        p.cancel("Cancelled");
        process.exit(0);
      },
    }
  );

  const input = normalizeUserPath(opts.input);
  const output = normalizeUserPath(opts.output);
  const svgInput = isSvgInputPath(input);
  const res = opts.res ?? Number(opts.customRes) / 100;
  const fps = opts.motion ?? Number(opts.customFps);
  const colors = opts.colors ?? Number(opts.customColors);

  p.outro(
    `Converting ${input} → ${output} @ ${Math.round(res * 100)}% res, ${fps} fps, ${colors} colors`
  );

  return {
    input,
    output,
    res,
    fps,
    colors,
    autoCrop: svgInput ? false : opts.autoCrop,
    optimizeFrames: svgInput ? false : opts.optimizeFrames,
    start: svgInput ? undefined : opts.clip ? opts.start : undefined,
    duration: svgInput ? undefined : opts.clip ? opts.duration : undefined,
    maxSizeMB: opts.maxSize ? Number(opts.maxSize) : null,
  };
}

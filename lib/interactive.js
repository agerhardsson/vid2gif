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

export async function runInteractive() {
  p.intro("vid2gif");

  const opts = await p.group(
    {
      input: () =>
        p.text({
          message: "Input video file",
          placeholder: "path/to/video.mp4",
          validate: (v) => {
            if (!v) return "Required";
            if (!fs.existsSync(v)) return "File not found";
          },
        }),

      output: ({ results }) =>
        p.text({
          message: "Output GIF file",
          placeholder: results.input
            ? results.input.replace(/\.[^.]+$/, ".gif")
            : "output.gif",
          initialValue: results.input
            ? results.input.replace(/\.[^.]+$/, ".gif")
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

      autoCrop: () =>
        p.confirm({
          message: "Auto-crop empty borders?",
          initialValue: true,
        }),

      optimizeFrames: () =>
        p.confirm({
          message: "Optimize frames? (drops near-duplicate frames)",
          initialValue: true,
        }),

      clip: () =>
        p.confirm({
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

  const res = opts.res ?? Number(opts.customRes) / 100;
  const fps = opts.motion ?? Number(opts.customFps);
  const colors = opts.colors ?? Number(opts.customColors);

  p.outro(
    `Converting ${opts.input} → ${opts.output} @ ${Math.round(res * 100)}% res, ${fps} fps, ${colors} colors`
  );

  return {
    input: opts.input,
    output: opts.output,
    res,
    fps,
    colors,
    autoCrop: opts.autoCrop,
    optimizeFrames: opts.optimizeFrames,
    start: opts.clip ? opts.start : undefined,
    duration: opts.clip ? opts.duration : undefined,
    maxSizeMB: opts.maxSize ? Number(opts.maxSize) : null,
  };
}

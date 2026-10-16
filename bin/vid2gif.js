#!/usr/bin/env node

import { Command } from "commander";
import { convertVideoToGif } from "../lib/convert.js";
import { runInteractive } from "../lib/interactive.js";

const MOTION_MAP = { low: 10, medium: 15, high: 24 };

const program = new Command();

program
  .name("vid2gif")
  .description("Convert video, SVG, or a folder of PNG frames to an optimized GIF")
  .argument("[input]", "input video, SVG, or folder of PNG frames")
  .argument("[output]", "output gif")
  .option("--res <0.0-2.0>", "resolution as % of original", "0.75")
  .option("--motion <level>", "motion level: low|medium|high", "medium")
  .option("-f, --fps <n>", "frames per second (overrides --motion)")
  .option("--colors <n>", "max palette colors", "256")
  .option("--no-crop", "disable auto border cropping")
  .option("--no-frame-opt", "disable frame optimization")
  .option("--start <sec>", "clip start")
  .option("--duration <sec>", "clip duration")
  .option("--max-size <mb>", "target gif size in MB")
  .action(async (input, output, options) => {
    try {
      if (!input) {
        const interactiveOpts = await runInteractive();
        await convertVideoToGif(interactiveOpts);
        return;
      }

      if (!output) {
        console.error("Error: output file required when passing input");
        process.exit(1);
      }

      const fps = options.fps
        ? Number(options.fps)
        : MOTION_MAP[options.motion] ?? 15;

      await convertVideoToGif({
        input,
        output,
        res: Number(options.res),
        fps,
        colors: Number(options.colors),
        autoCrop: options.crop !== false,
        optimizeFrames: options.frameOpt !== false,
        start: options.start,
        duration: options.duration,
        maxSizeMB: options.maxSize ? Number(options.maxSize) : null,
      });
    } catch (err) {
      console.error("Error:", err.message);
      process.exit(1);
    }
  });

program.parse();

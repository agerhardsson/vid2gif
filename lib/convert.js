import { Resvg } from "@resvg/resvg-js";
import { execa } from "execa";
import fs from "fs";
import path from "path";
import tmp from "tmp";
import cliProgress from "cli-progress";

function isSvgInput(filePath) {
  return path.extname(filePath).toLowerCase() === ".svg";
}

function normalizePathInput(value) {
  if (typeof value !== "string") return value;

  const trimmed = value.trim();
  const quoted = trimmed.match(/^("|')(.*)\1$/);

  return quoted ? quoted[2].trim() : trimmed;
}

function parseDurationSeconds(value) {
  if (!value) return null;

  const match = String(value).trim().match(/^(\d*\.?\d+)(ms|s)?$/i);
  if (!match) return null;

  const amount = Number(match[1]);
  return match[2]?.toLowerCase() === "ms" ? amount / 1000 : amount;
}

function stripSvgDocumentWrappers(svgText) {
  return svgText
    .replace(/^\s*<\?xml[^>]*>\s*/i, "")
    .replace(/^\s*<!DOCTYPE[^>]*>\s*/i, "")
    .trim();
}

function hasAnimatedSvgContent(svgText) {
  return /<animate\b|<animateTransform\b|<set\b|@keyframes|animation:/i.test(svgText);
}

function getAnimatedSvgDuration(svgText) {
  const durations = [];

  for (const match of svgText.matchAll(/animation:[^;]*?(\d*\.?\d+m?s)\b/gi)) {
    const duration = parseDurationSeconds(match[1]);
    if (duration) durations.push(duration);
  }

  for (const match of svgText.matchAll(/\bdur=["']?(\d*\.?\d+m?s)\b/gi)) {
    const duration = parseDurationSeconds(match[1]);
    if (duration) durations.push(duration);
  }

  return durations.length > 0 ? Math.max(...durations) : null;
}

function readSvgInfo(filePath) {
  const svgText = fs.readFileSync(filePath, "utf8");
  const resvg = new Resvg(svgText);

  return {
    svgText,
    width: resvg.width,
    height: resvg.height,
    animated: hasAnimatedSvgContent(svgText),
    animationDuration: getAnimatedSvgDuration(svgText),
  };
}

async function probeInput(filePath) {
  const { stdout } = await execa("ffprobe", [
    "-v", "error",
    "-of", "json",
    "-show_streams",
    "-show_format",
    filePath,
  ]);
  const data = JSON.parse(stdout);
  const stream = data.streams?.find((s) => s.codec_type === "video");
  return {
    width: stream?.width || 0,
    height: stream?.height || 0,
    duration: parseFloat(data.format?.duration || 0),
  };
}

function rasterizeSvgToPng(svgText) {
  const resvg = new Resvg(svgText);
  const pngData = resvg.render();
  const pngTmp = tmp.fileSync({ postfix: ".png" });

  fs.writeFileSync(pngTmp.name, pngData.asPng());

  return {
    tmpFile: pngTmp,
    width: resvg.width,
    height: resvg.height,
  };
}

async function captureAnimatedSvgFrames({
  svgText,
  width,
  height,
  fps,
  durationSeconds,
  startSeconds,
}) {
  const { default: puppeteer } = await import("puppeteer");
  const framesDir = tmp.dirSync({ unsafeCleanup: true });
  const frameCount = Math.max(1, Math.ceil(durationSeconds * fps));
  const frameDelayMs = frameCount > 1 ? Math.max(1, Math.round(1000 / fps)) : 0;
  const browser = await puppeteer.launch({ headless: true });

  try {
    const page = await browser.newPage();
    await page.setViewport({
      width: Math.max(Math.round(width), 1),
      height: Math.max(Math.round(height), 1),
      deviceScaleFactor: 1,
    });

    await page.setContent(
      `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      html, body {
        margin: 0;
        padding: 0;
        background: transparent;
        overflow: hidden;
        width: ${Math.round(width)}px;
        height: ${Math.round(height)}px;
      }
      body > svg {
        display: block;
        width: ${Math.round(width)}px;
        height: ${Math.round(height)}px;
      }
    </style>
  </head>
  <body>${stripSvgDocumentWrappers(svgText)}</body>
</html>`,
      { waitUntil: "load" }
    );

    await page.evaluate(
      () =>
        new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        })
    );

    if (startSeconds > 0) {
      await new Promise((resolve) => setTimeout(resolve, Math.round(startSeconds * 1000)));
    }

    console.log(
      `SVG animation detected: capturing ${frameCount} frames over ${durationSeconds.toFixed(2)}s @ ${fps}fps`
    );

    for (let index = 0; index < frameCount; index += 1) {
      const framePath = path.join(
        framesDir.name,
        `frame-${String(index + 1).padStart(5, "0")}.png`
      );

      await page.screenshot({
        path: framePath,
        omitBackground: true,
        clip: {
          x: 0,
          y: 0,
          width: Math.round(width),
          height: Math.round(height),
        },
      });

      if (frameDelayMs > 0 && index < frameCount - 1) {
        await new Promise((resolve) => setTimeout(resolve, frameDelayMs));
      }
    }

    return {
      framesDir,
      framePattern: path.join(framesDir.name, "frame-%05d.png"),
      frameCount,
      durationSeconds,
    };
  } catch (error) {
    framesDir.removeCallback();
    throw error;
  } finally {
    await browser.close();
  }
}

async function detectCrop(filePath) {
  const proc = execa("ffmpeg", [
    "-i", filePath,
    "-t", "2",
    "-vf", "cropdetect=round=2",
    "-f", "null",
    "-",
  ]);

  let stderr = "";
  proc.stderr.on("data", (d) => (stderr += d.toString()));
  await proc.catch(() => {});

  const matches = [...stderr.matchAll(/crop=(\d+):(\d+):(\d+):(\d+)/g)];
  if (matches.length === 0) return null;

  return matches[matches.length - 1][0];
}

function buildPreFilters(cropFilter, optimizeFrames) {
  return [cropFilter, optimizeFrames && "mpdecimate"]
    .filter(Boolean)
    .join(",");
}

function buildOutputFilters(preFilters, res, fps, isPalette, colors, options = {}) {
  const { includeFps = true } = options;
  const coreParts = [];

  if (includeFps) {
    coreParts.push(`fps=${fps}`);
  }

  coreParts.push(`scale=iw*${res}:-1:flags=lanczos`);

  const core = coreParts.join(",");
  const prefix = preFilters ? `${preFilters},` : "";

  if (isPalette) {
    return `${prefix}${core},palettegen=stats_mode=diff:max_colors=${colors}`;
  }

  return `${prefix}${core}[x];[x][1:v]paletteuse=dither=sierra2_4a:diff_mode=rectangle`;
}

async function runFfmpeg(args, progressBar) {
  const proc = execa("ffmpeg", args, { buffer: false });

  proc.stderr.on("data", (data) => {
    const match = data.toString().match(/time=(\d+):(\d+):(\d+\.\d+)/);
    if (match && progressBar) {
      progressBar.update(
        Number(match[1]) * 3600 +
        Number(match[2]) * 60 +
        Number(match[3])
      );
    }
  });

  await proc;
}

async function renderGif({
  inputArgs,
  paletteArgs,
  gifArgs,
  output,
  progressDuration,
  maxSizeMB,
  opts,
}) {
  const paletteTmp = tmp.fileSync({ postfix: ".png" });
  const palette = paletteTmp.name;
  const progressBar = progressDuration
    ? new cliProgress.SingleBar({
        format: "Converting [{bar}] {percentage}%",
      })
    : null;

  if (progressBar) {
    progressBar.start(Math.max(progressDuration, 1), 0);
  }

  try {
    console.log("Generating palette...");

    await runFfmpeg([
      ...inputArgs,
      ...paletteArgs,
      "-y",
      palette,
    ]);

    console.log("Rendering GIF...");

    await runFfmpeg(
      [
        ...inputArgs,
        "-i", palette,
        ...gifArgs,
        "-y",
        output,
      ],
      progressBar
    );

    if (maxSizeMB) {
      const stats = fs.statSync(output);
      const sizeMB = stats.size / (1024 * 1024);

      if (sizeMB > maxSizeMB) {
        const ratio = Math.sqrt(maxSizeMB / sizeMB);
        const newRes = Math.max(Math.round(opts.res * ratio * 100) / 100, 0.05);
        console.log(
          `GIF is ${sizeMB.toFixed(1)}MB, target ${maxSizeMB}MB. ` +
          `Scaling res to ${Math.round(newRes * 100)}%...`
        );
        await convertVideoToGif({ ...opts, res: newRes, autoCrop: false });
        return;
      }
    }

    console.log("Done:", output);
  } finally {
    progressBar?.stop();
    paletteTmp.removeCallback();
  }
}

export async function convertVideoToGif(opts) {
  const {
    input: rawInput,
    output: rawOutput,
    res,
    fps,
    start,
    duration,
    maxSizeMB,
    colors,
    autoCrop,
    optimizeFrames,
  } = opts;

  const input = normalizePathInput(rawInput);
  const output = normalizePathInput(rawOutput);

  if (!fs.existsSync(input)) {
    throw new Error("Input file not found");
  }

  const svgInput = isSvgInput(input);

  if (svgInput) {
    const svg = readSvgInfo(input);
    const outputWidth = svg.width ? Math.round(svg.width * res) : "?";
    const outputHeight = svg.height ? Math.round(svg.height * res) : "?";
    const startSeconds = parseDurationSeconds(start) ?? 0;
    const svgDuration = parseDurationSeconds(duration) ?? svg.animationDuration ?? 3;

    console.log(`Source: SVG ${svg.width}×${svg.height}`);
    console.log(`Output: ${outputWidth}×${outputHeight} @ ${fps}fps, ${colors} colors`);

    if (svg.animated) {
      const frames = await captureAnimatedSvgFrames({
        svgText: svg.svgText,
        width: svg.width,
        height: svg.height,
        fps,
        durationSeconds: svgDuration,
        startSeconds,
      });

      try {
        await renderGif({
          inputArgs: ["-framerate", String(fps), "-i", frames.framePattern],
          paletteArgs: [
            "-vf",
            buildOutputFilters("", res, fps, true, colors, { includeFps: false }),
          ],
          gifArgs: [
            "-lavfi",
            buildOutputFilters("", res, fps, false, colors, { includeFps: false }),
          ],
          output,
          progressDuration: frames.durationSeconds,
          maxSizeMB,
          opts: {
            ...opts,
            input,
            output,
          },
        });
      } finally {
        frames.framesDir.removeCallback();
      }

      return;
    }

    const svgRaster = rasterizeSvgToPng(svg.svgText);

    try {
      await renderGif({
        inputArgs: ["-i", svgRaster.tmpFile.name],
        paletteArgs: [
          "-vf",
          buildOutputFilters("", res, fps, true, colors, { includeFps: false }),
          "-frames:v",
          "1",
        ],
        gifArgs: [
          "-lavfi",
          buildOutputFilters("", res, fps, false, colors, { includeFps: false }),
          "-frames:v",
          "1",
        ],
        output,
        progressDuration: null,
        maxSizeMB,
        opts: {
          ...opts,
          input,
          output,
        },
      });
    } finally {
      svgRaster.tmpFile.removeCallback();
    }

    return;
  }

  const meta = await probeInput(input);
  const outW = meta.width ? Math.round(meta.width * res) : "?";
  const outH = meta.height ? Math.round(meta.height * res) : "?";
  const clipDuration = duration ? parseFloat(duration) : meta.duration;

  console.log(`Source: ${meta.width}×${meta.height} @ ${meta.duration?.toFixed(1) || "?"}s`);

  let cropFilter = null;
  if (autoCrop !== false) {
    const crop = await detectCrop(input);
    if (crop) {
      const [, w, h] = crop.match(/(\d+):(\d+):(\d+):(\d+)/);
      console.log(`Auto crop: ${meta.width}×${meta.height} → ${w}×${h}`);
      cropFilter = crop;
    }
  }

  if (optimizeFrames !== false) {
    console.log("Frame optimization: enabled (mpdecimate)");
  }

  console.log(`Output: ${outW}×${outH || "?"} @ ${fps}fps, ${colors} colors`);

  const preFilters = buildPreFilters(cropFilter, optimizeFrames !== false);
  const seekArgs = [];
  if (start) seekArgs.push("-ss", start);
  if (duration) seekArgs.push("-t", duration);

  await renderGif({
    inputArgs: [...seekArgs, "-i", input],
    paletteArgs: [
      "-vf",
      buildOutputFilters(preFilters, res, fps, true, colors),
    ],
    gifArgs: [
      "-lavfi",
      buildOutputFilters(preFilters, res, fps, false, colors),
    ],
    output,
    progressDuration: clipDuration,
    maxSizeMB,
    opts: {
      ...opts,
      input,
      output,
    },
  });
}

import { execa } from "execa";
import fs from "fs";
import tmp from "tmp";
import cliProgress from "cli-progress";

async function probeVideo(filePath) {
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

function buildOutputFilters(preFilters, res, fps, isPalette, colors) {
  const core = `fps=${fps},scale=iw*${res}:-1:flags=lanczos`;
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

export async function convertVideoToGif(opts) {
  const {
    input,
    output,
    res,
    fps,
    start,
    duration,
    maxSizeMB,
    colors,
    autoCrop,
    optimizeFrames,
  } = opts;

  if (!fs.existsSync(input)) {
    throw new Error("Input file not found");
  }

  const meta = await probeVideo(input);
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

  const paletteTmp = tmp.fileSync({ postfix: ".png" });
  const palette = paletteTmp.name;

  const progressBar = new cliProgress.SingleBar({
    format: "Converting [{bar}] {percentage}%",
  });
  progressBar.start(Math.max(clipDuration, 1), 0);

  const seekArgs = [];
  if (start) seekArgs.push("-ss", start);
  if (duration) seekArgs.push("-t", duration);

  console.log("Generating palette...");

  await runFfmpeg([
    ...seekArgs,
    "-i", input,
    "-vf",
    buildOutputFilters(preFilters, res, fps, true, colors),
    "-y",
    palette,
  ]);

  console.log("Rendering GIF...");

  await runFfmpeg(
    [
      ...seekArgs,
      "-i", input,
      "-i", palette,
      "-lavfi",
      buildOutputFilters(preFilters, res, fps, false, colors),
      "-y",
      output,
    ],
    progressBar
  );

  progressBar.stop();

  if (maxSizeMB) {
    const stats = fs.statSync(output);
    const sizeMB = stats.size / (1024 * 1024);

    if (sizeMB > maxSizeMB) {
      paletteTmp.removeCallback();
      const ratio = Math.sqrt(maxSizeMB / sizeMB);
      const newRes = Math.max(Math.round(res * ratio * 100) / 100, 0.05);
      console.log(
        `GIF is ${sizeMB.toFixed(1)}MB, target ${maxSizeMB}MB. ` +
        `Scaling res to ${Math.round(newRes * 100)}%...`
      );
      await convertVideoToGif({ ...opts, res: newRes, autoCrop: false });
      return;
    }
  }

  paletteTmp.removeCallback();
  console.log("Done:", output);
}

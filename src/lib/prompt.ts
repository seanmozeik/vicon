import type { ToolContext } from "../types.js";

// Common output format → required ffmpeg encoder.
// Used to help the AI cross-reference before generating commands.
const FORMAT_ENCODER_REF = `\
## Output Format → Required ffmpeg Encoder
webp      → libwebp
hevc/h265 → libx265
h264/mp4/mov/mkv → libx264
vp8/webm  → libvpx
vp9       → libvpx-vp9
av1       → libsvtav1 or libaom-av1
gif       → gif (built-in)
png       → png (built-in)
jpeg/jpg  → mjpeg (built-in)
mp3       → libmp3lame
aac       → aac (built-in)
opus      → libopus
flac      → flac (built-in)
Use this table to identify which encoder is needed, then verify it appears in the available encoder lists before generating any command.`;

export function buildSystemPrompt(ctx: ToolContext): string {
	const lines: string[] = [];

	lines.push("## Available Tools");

	if (ctx.ffmpeg.installed) {
		lines.push(`ffmpeg ${ctx.ffmpeg.version ?? "unknown"}`);
		lines.push(
			`  Video encoders: ${ctx.ffmpeg.videoEncoders.join(", ") || "none"}`,
		);
		lines.push(
			`  Audio encoders: ${ctx.ffmpeg.audioEncoders.join(", ") || "none"}`,
		);
	} else {
		lines.push("ffmpeg: NOT installed — do not generate ffmpeg commands");
	}

	if (ctx.magick.installed) {
		lines.push(`magick ${ctx.magick.version ?? "unknown"}`);
		lines.push(`  Formats: ${ctx.magick.formats.join(", ") || "none"}`);
	} else {
		lines.push("magick: NOT installed — do not generate magick commands");
	}

	const environment = lines.join("\n");

	const rules = `## Rules
Return ONLY valid JSON in this exact shape: { "commands": string[], "explanation": string }
- explanation: plain prose only — no shell syntax, no backticks, no code
- commands: complete, copy-pasteable shell strings — no placeholders, no &&, no loops
- BEFORE generating any command: identify the required encoder/format using the reference table below, then verify it appears in the available lists above
- NEVER rely on ffmpeg auto-selection — always specify -c:v for video output and -c:a for audio output explicitly
- If a required ffmpeg encoder is not available, use magick if the format is in its format list
- If neither tool can handle the task, return { "commands": [], "explanation": "<reason why it cannot be done with available tools>" }
- Prefer non-destructive output: append _converted to output filenames, use -n flag to avoid overwriting
- For batch tasks, emit one command per file
IMPORTANT: Reply with ONLY the JSON object — no markdown fences, no extra text`;

	return [environment, FORMAT_ENCODER_REF, rules].join("\n\n");
}

export function buildUserPrompt(request: string): string {
	return request;
}

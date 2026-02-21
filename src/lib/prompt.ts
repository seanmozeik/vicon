import type { ToolContext } from "../types.js";

export function buildSystemPrompt(ctx: ToolContext): string {
	const lines: string[] = [];

	lines.push("## Available Tools");

	if (ctx.ffmpeg.installed) {
		lines.push(`FFmpeg ${ctx.ffmpeg.version ?? "unknown"}`);
		lines.push(`  Codecs: ${ctx.ffmpeg.codecs.join(", ") || "none"}`);
		lines.push(`  Filters: ${ctx.ffmpeg.filters.join(", ") || "none"}`);
		lines.push(
			`  Bitstream filters: ${ctx.ffmpeg.bitstreamFilters.join(", ") || "none"}`,
		);
		lines.push(`  Formats: ${ctx.ffmpeg.formats.join(", ") || "none"}`);
	} else {
		lines.push("FFmpeg: NOT installed — do not generate ffmpeg commands");
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
- BEFORE generating any command: choose the optimal codec and encoder from the available codecs list above for the target format, preferring hardware-accelerated encoders (e.g. h264_videotoolbox, hevc_videotoolbox) over software ones, and modern codecs (av1, hevc) over older ones when quality/efficiency matters
- NEVER rely on FFmpeg auto-selection — always specify -c:v for video output and -c:a for audio output explicitly
- If a required FFmpeg encoder is not available, use magick if the format is in its format list
- If neither tool can handle the task, return { "commands": [], "explanation": "<reason why it cannot be done with available tools>" }
- Prefer non-destructive output: append _converted to output filenames, use -n flag to avoid overwriting
- For batch tasks, emit one command per file
IMPORTANT: Reply with ONLY the JSON object — no markdown fences, no extra text`;

	return [environment, rules].join("\n\n");
}

export function buildUserPrompt(request: string): string {
	return request;
}

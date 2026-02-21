import type { ToolContext } from "../types.js";

export function buildSystemPrompt(ctx: ToolContext): string {
	const ffmpegLine = ctx.ffmpeg.installed
		? `ffmpeg ${ctx.ffmpeg.version ?? "unknown"} | encoders: [${ctx.ffmpeg.encoders.join(", ")}] | decoders: [${ctx.ffmpeg.decoders.join(", ")}]`
		: "ffmpeg: not installed";

	const magickLine = ctx.magick.installed
		? `magick ${ctx.magick.version ?? "unknown"} | formats: [${ctx.magick.formats.join(", ")}]`
		: "magick: not installed";

	const environment = `## Environment\n${ffmpegLine}\n${magickLine}`;

	const rules = `## Rules
Return ONLY valid JSON in this exact shape: { "commands": string[], "explanation": string }
- explanation: plain prose only — no shell syntax, no backticks, no code
- commands: complete, copy-pasteable shell strings — no placeholders, no &&, no loops
- Only use tools that are listed as installed above
- Prefer non-destructive output: append _converted to output filenames, use -n flag to avoid overwriting
- For batch tasks, emit one command per file
IMPORTANT: Reply with ONLY the JSON object — no markdown fences, no extra text`;

	return [environment, rules].join("\n\n");
}

export function buildUserPrompt(request: string): string {
	return request;
}

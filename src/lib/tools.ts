import type { ToolContext } from "../types.js";

let cached: ToolContext | undefined;

async function run(cmd: string[]): Promise<string> {
	try {
		const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
		return (await new Response(proc.stdout).text()).trim();
	} catch {
		return "";
	}
}

async function probeFfmpeg(): Promise<ToolContext["ffmpeg"]> {
	const versionOut = await run(["ffmpeg", "-version"]);
	if (!versionOut)
		return {
			installed: false,
			videoEncoders: [],
			audioEncoders: [],
			decoders: [],
		};

	const versionMatch = versionOut.split("\n")[0]?.match(/ffmpeg version (\S+)/);
	const version = versionMatch?.[1];

	const encodersOut = await run(["ffmpeg", "-encoders"]);
	const decodersOut = await run(["ffmpeg", "-decoders"]);

	const parseEncoderLines = (out: string) =>
		out
			.split("\n")
			.filter((l) => /^ [VAS][A-Z.]{5} \S/.test(l))
			.map((l) => ({ type: l[1], name: l.trim().split(/\s+/)[1] ?? "" }))
			.filter((e) => e.name);

	const encoderEntries = parseEncoderLines(encodersOut);
	const videoEncoders = encoderEntries
		.filter((e) => e.type === "V")
		.map((e) => e.name);
	const audioEncoders = encoderEntries
		.filter((e) => e.type === "A")
		.map((e) => e.name);

	const decoders = parseEncoderLines(decodersOut).map((e) => e.name);

	return { installed: true, version, videoEncoders, audioEncoders, decoders };
}

async function probeMagick(): Promise<ToolContext["magick"]> {
	const versionOut = await run(["magick", "-version"]);
	if (!versionOut) return { installed: false, formats: [] };

	const versionMatch = versionOut
		.split("\n")[0]
		?.match(/Version: ImageMagick (\S+)/);
	const version = versionMatch?.[1];

	const formatsOut = await run(["magick", "-list", "format"]);

	const formats = formatsOut
		.split("\n")
		.filter((l) => /^\s+[A-Z0-9]+\*?\s/.test(l))
		.map((l) => l.trim().split(/\s+/)[0]?.replace("*", "") ?? "")
		.filter(Boolean);

	return { installed: true, version, formats };
}

export async function detectContext(): Promise<ToolContext> {
	if (cached) return cached;

	const [ffmpeg, magick] = await Promise.all([probeFfmpeg(), probeMagick()]);
	cached = { ffmpeg, magick };
	return cached;
}

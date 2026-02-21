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
			codecs: [],
			filters: [],
			bitstreamFilters: [],
			formats: [],
		};

	const versionMatch = versionOut.split("\n")[0]?.match(/ffmpeg version (\S+)/);
	const version = versionMatch?.[1];

	const [codecsOut, filtersOut, bsfsOut, formatsOut] = await Promise.all([
		run(["ffmpeg", "-codecs"]),
		run(["ffmpeg", "-filters"]),
		run(["ffmpeg", "-bsfs"]),
		run(["ffmpeg", "-formats"]),
	]);

	// Codecs: " DEV.LS h264  H.264 ... (encoders: libx264 h264_videotoolbox)"
	const codecs = codecsOut
		.split("\n")
		.filter((l) => /^ [D.][E.][VASDT][I.][L.][S.] \S/.test(l))
		.map((l) => {
			const rest = l.slice(8);
			const name = rest.trim().split(/\s+/)[0] ?? "";
			const encoderMatch = rest.match(/\(encoders: ([^)]+)\)/);
			return encoderMatch ? `${name} (encoders: ${encoderMatch[1]})` : name;
		})
		.filter(Boolean);

	// Filters: " TS scale  V->V  description"
	const filters = filtersOut
		.split("\n")
		.filter((l) => /^ [T.][S.] \w/.test(l))
		.map((l) => l.slice(4).trim().split(/\s+/)[0] ?? "")
		.filter(Boolean);

	// Bitstream filters: simple list after header
	const bsfLines = bsfsOut.split("\n");
	const bsfStart = bsfLines.findIndex((l) =>
		l.includes("Bitstream filters:"),
	);
	const bitstreamFilters =
		bsfStart >= 0
			? bsfLines
					.slice(bsfStart + 1)
					.map((l) => l.trim())
					.filter(Boolean)
			: [];

	// Formats: " DE  avi  AVI (Audio Video Interleaved)"
	const formats = formatsOut
		.split("\n")
		.filter((l) => /^ [D ][E ][d ] \S/.test(l))
		.map((l) => l.slice(5).trim().split(/\s+/)[0] ?? "")
		.filter(Boolean);

	return {
		installed: true,
		version,
		codecs,
		filters,
		bitstreamFilters,
		formats,
	};
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

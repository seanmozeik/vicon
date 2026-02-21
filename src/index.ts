import * as p from "@clack/prompts";
import boxen from "boxen";
import { generate, ValidationError } from "./lib/ai.js";
import { copyToClipboard } from "./lib/clipboard.js";
import type { Provider, ViconConfig } from "./lib/config.js";
import { deleteConfig, getConfig, setConfig } from "./lib/config.js";
import { buildSystemPrompt, buildUserPrompt } from "./lib/prompt.js";
import { runCommands } from "./lib/run.js";
import { detectContext } from "./lib/tools.js";
import type { GenerateResult } from "./types.js";
import { showBanner } from "./ui/banner.js";
import { boxColors, frappe, theme } from "./ui/theme.js";

// ── Arg parsing ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

function popFlag(flags: string[]): string | undefined {
	for (const flag of flags) {
		const i = args.indexOf(flag);
		if (i !== -1) {
			args.splice(i, 1);
			return flag;
		}
	}
	return undefined;
}

function popFlagValue(flag: string): string | undefined {
	const i = args.indexOf(flag);
	if (i !== -1 && i + 1 < args.length) {
		const val = args[i + 1];
		args.splice(i, 2);
		return val;
	}
	return undefined;
}

const helpFlag = popFlag(["--help", "-h"]);
const versionFlag = popFlag(["--version", "-v"]);
const providerOverride = popFlagValue("--provider") as Provider | undefined;

// ── Help & Version ────────────────────────────────────────────────────────────

if (versionFlag) {
	const pkg = (await import("../package.json")) as { version: string };
	console.log(`vicon v${pkg.version}`);
	process.exit(0);
}

if (helpFlag) {
	showBanner();
	console.log(
		[
			"",
			`  ${theme.heading("Usage:")} vicon <request> [--provider cloudflare|claude]`,
			"",
			`  ${theme.heading("Subcommands:")}`,
			`    ${frappe.sky("setup")}      Configure AI provider credentials`,
			`    ${frappe.sky("teardown")}   Remove saved credentials`,
			"",
			`  ${theme.heading("Flags:")}`,
			`    ${frappe.sky("--provider")}  Override provider for this invocation`,
			`    ${frappe.sky("--help")}      Show this help`,
			`    ${frappe.sky("--version")}   Print version`,
			"",
			`  ${theme.heading("Examples:")}`,
			`    vicon "convert video.mp4 to gif at 15fps"`,
			`    vicon "resize all jpgs in this folder to 800px wide"`,
			`    vicon "extract audio from interview.mov as flac" --provider claude`,
			"",
		].join("\n"),
	);
	process.exit(0);
}

// ── Subcommands ───────────────────────────────────────────────────────────────

async function setupCloudflare(): Promise<void> {
	const accountId = await p.text({
		message: "Cloudflare Account ID:",
		validate: (v) => (v?.trim() ? undefined : "Required"),
	});
	if (p.isCancel(accountId)) {
		p.cancel("Setup cancelled.");
		process.exit(0);
	}

	const apiToken = await p.password({
		message: "Cloudflare AI API token:",
		validate: (v) => (v?.trim() ? undefined : "Required"),
	});
	if (p.isCancel(apiToken)) {
		p.cancel("Setup cancelled.");
		process.exit(0);
	}

	const config: ViconConfig = {
		defaultProvider: "cloudflare",
		cloudflare: {
			accountId: (accountId as string).trim(),
			apiToken: (apiToken as string).trim(),
		},
	};
	try {
		await setConfig(config);
	} catch (err) {
		p.log.error(err instanceof Error ? err.message : String(err));
		process.exit(1);
	}
	p.outro("Cloudflare AI configured and saved.");
}

async function runSetup(): Promise<void> {
	showBanner();
	p.intro("Configure vicon AI provider");

	const provider = await p.select<Provider>({
		message: "Which AI provider?",
		options: [
			{
				value: "cloudflare" as Provider,
				label: "Cloudflare AI",
				hint: "requires Account ID + API token",
			},
			{
				value: "claude" as Provider,
				label: "Claude Code CLI",
				hint: "requires claude CLI installed",
			},
		],
	});

	if (p.isCancel(provider)) {
		p.cancel("Setup cancelled.");
		process.exit(0);
	}

	if ((provider as Provider) === "cloudflare") {
		await setupCloudflare();
		return;
	}

	// claude — verify CLI is available
	const proc = Bun.spawn(["which", "claude"], {
		stdout: "pipe",
		stderr: "pipe",
	});
	await proc.exited;
	if (proc.exitCode !== 0) {
		p.log.error(
			"claude CLI not found. Install it from https://claude.ai/code and re-run setup.",
		);
		process.exit(1);
	}

	const config: ViconConfig = { defaultProvider: "claude" };
	try {
		await setConfig(config);
	} catch (err) {
		p.log.error(err instanceof Error ? err.message : String(err));
		process.exit(1);
	}
	p.outro("Claude Code CLI configured and saved.");
}

async function runTeardown(): Promise<void> {
	showBanner();

	const confirm = await p.confirm({
		message: "Delete vicon config from keychain?",
		initialValue: false,
	});

	if (p.isCancel(confirm) || !confirm) {
		p.outro("Teardown cancelled.");
		process.exit(0);
	}

	await deleteConfig();
	p.outro("Config deleted.");
}

// ── Tool summary line ─────────────────────────────────────────────────────────

type ToolCtx = Awaited<ReturnType<typeof detectContext>>;

function renderToolSummary(ctx: ToolCtx): string {
	const parts: string[] = [];

	if (ctx.ffmpeg.installed) {
		const ver = ctx.ffmpeg.version ?? "?";
		const enc =
			ctx.ffmpeg.videoEncoders.length + ctx.ffmpeg.audioEncoders.length;
		const dec = ctx.ffmpeg.decoders.length;
		parts.push(
			theme.muted(`ffmpeg ${ver} (${enc} encoders · ${dec} decoders)`),
		);
	} else {
		parts.push(frappe.yellow("ffmpeg not found"));
	}

	if (ctx.magick.installed) {
		const ver = ctx.magick.version ?? "?";
		const fmt = ctx.magick.formats.length;
		parts.push(theme.muted(`magick ${ver} (${fmt} formats)`));
	} else {
		parts.push(frappe.yellow("magick not found"));
	}

	return parts.join(theme.muted("  ·  "));
}

// ── Display panels ────────────────────────────────────────────────────────────

function renderPanels(result: GenerateResult): void {
	const explanationBox = boxen(result.explanation, {
		borderColor: boxColors.primary,
		borderStyle: "round",
		padding: { top: 1, bottom: 1, left: 2, right: 2 },
		title: "What this does",
		titleAlignment: "center",
	});
	console.log(`\n${explanationBox}`);

	const numberedCmds = result.commands
		.map((cmd, i) => `${frappe.sky(`[${i + 1}]`)} ${cmd}`)
		.join("\n");

	const commandsBox = boxen(numberedCmds, {
		borderColor: boxColors.default,
		dimBorder: true,
		borderStyle: "round",
		padding: { top: 0, bottom: 0, left: 1, right: 1 },
		title: "Commands",
		titleAlignment: "left",
	});
	console.log(`\n${commandsBox}\n`);
}

// ── Post-run cleanup ──────────────────────────────────────────────────────────

const MEDIA_EXT_RE =
	/\S+\.(?:png|jpg|jpeg|gif|webp|avif|mp4|mov|mkv|mp3|wav|flac|aac)/gi;

function inferInputFiles(commands: string[]): string[] {
	const files = new Set<string>();
	for (const cmd of commands) {
		const matches = cmd.match(MEDIA_EXT_RE);
		if (matches) {
			for (const m of matches) files.add(m);
		}
	}
	return [...files];
}

async function runCleanup(files: string[]): Promise<void> {
	if (files.length === 0) return;

	p.log.info(`Input files detected:\n  ${files.join("\n  ")}`);

	const confirm = await p.confirm({
		message: "Delete original files?",
		initialValue: false,
	});

	if (p.isCancel(confirm) || !confirm) return;

	for (const file of files) {
		try {
			await Bun.$`rm ${file}`;
			p.log.success(`Deleted ${file}`);
		} catch {
			p.log.error(`Failed to delete ${file}`);
		}
	}
}

// ── Conversion helpers ────────────────────────────────────────────────────────

async function tryGenerate(
	userRequest: string,
	ctx: ToolCtx,
	config: ViconConfig,
): Promise<GenerateResult | null> {
	const s = p.spinner();
	s.start("Generating command…");
	try {
		const result = await generate(
			buildSystemPrompt(ctx),
			buildUserPrompt(userRequest),
			config,
		);
		s.stop("Done.");
		return result;
	} catch (err) {
		s.stop("Failed.");
		if (err instanceof ValidationError) {
			p.log.error("Could not parse AI response:");
			console.log(err.raw);
		} else {
			p.log.error(err instanceof Error ? err.message : String(err));
		}
		return null;
	}
}

// Returns updated request string (same or edited) on retry, null on cancel.
async function promptErrorRecovery(
	currentRequest: string,
): Promise<string | null> {
	const recovery = await p.select({
		message: "What would you like to do?",
		options: [
			{ value: "retry", label: "Retry", hint: "regenerate with same prompt" },
			{
				value: "edit-prompt",
				label: "Edit prompt",
				hint: "modify your request and retry",
			},
			{ value: "cancel", label: "Cancel" },
		],
	});
	if (p.isCancel(recovery) || recovery === "cancel") return null;
	if (recovery !== "edit-prompt") return currentRequest;

	const edited = await p.text({
		message: "Edit your request:",
		initialValue: currentRequest,
	});
	if (p.isCancel(edited)) return null;
	return edited as string;
}

// Retries until a successful GenerateResult is obtained or the user cancels.
async function generateUntilSuccess(
	initialRequest: string,
	ctx: ToolCtx,
	config: ViconConfig,
): Promise<{ result: GenerateResult; userRequest: string }> {
	let userRequest = initialRequest;
	for (;;) {
		const result = await tryGenerate(userRequest, ctx, config);
		if (result !== null) return { result, userRequest };
		const next = await promptErrorRecovery(userRequest);
		if (next === null) {
			p.outro("Cancelled.");
			process.exit(0);
		}
		userRequest = next;
	}
}

async function handleEditPromptAction(
	userRequest: string,
	ctx: ToolCtx,
	config: ViconConfig,
): Promise<{ result: GenerateResult; userRequest: string }> {
	const edited = await p.text({
		message: "Edit your request:",
		initialValue: userRequest,
	});
	if (p.isCancel(edited)) {
		p.outro("Cancelled.");
		process.exit(0);
	}
	return generateUntilSuccess(edited as string, ctx, config);
}

async function handleCopyAction(commands: string[]): Promise<void> {
	const ok = await copyToClipboard(commands.join("\n"));
	if (ok) {
		p.log.success("Commands copied to clipboard.");
	} else {
		p.log.warn("No clipboard tool found. Install xclip, xsel, or wl-copy.");
	}
	process.exit(0);
}

async function handleEditCommandsAction(
	current: GenerateResult,
): Promise<GenerateResult> {
	const edited = await p.text({
		message: "Edit commands (one per line):",
		initialValue: current.commands.join("\n"),
	});
	if (p.isCancel(edited)) {
		p.outro("Cancelled.");
		process.exit(0);
	}
	const newCommands = (edited as string)
		.split("\n")
		.map((l) => l.trim())
		.filter(Boolean);
	return { ...current, commands: newCommands };
}

async function handleRunAction(commands: string[]): Promise<void> {
	const preExisting = new Set(
		await Promise.all(
			inferInputFiles(commands).map(async (f) => {
				const file = Bun.file(f);
				return (await file.exists()) ? f : null;
			}),
		).then((results) => results.filter((f): f is string => f !== null)),
	);

	const success = await runCommands(commands, {
		onBefore: (cmd, i, total) => p.log.step(`▶ [${i + 1}/${total}] ${cmd}`),
		onSuccess: () => p.log.success("All commands completed successfully."),
		onError: (cmd, exitCode) =>
			p.log.error(`Command exited with code ${exitCode}: ${cmd}`),
	});

	if (success) {
		await runCleanup([...preExisting]);
	}
	process.exit(success ? 0 : 1);
}

// ── Conversion flow ───────────────────────────────────────────────────────────

async function runConversion(
	initialRequest: string,
	config: ViconConfig,
): Promise<void> {
	const toolSpinner = p.spinner();
	toolSpinner.start("Detecting tools…");
	const ctx = await detectContext();
	toolSpinner.stop("Tools detected.");
	p.log.info(renderToolSummary(ctx));

	if (!ctx.ffmpeg.installed && !ctx.magick.installed) {
		p.log.error(
			"No media tools found. Install ffmpeg or ImageMagick and try again.",
		);
		process.exit(1);
	}

	let { result: currentResult, userRequest } = await generateUntilSuccess(
		initialRequest,
		ctx,
		config,
	);
	renderPanels(currentResult);

	while (true) {
		const action = await p.select({
			message: "What would you like to do?",
			options: [
				{ value: "run", label: "Run all" },
				{
					value: "edit",
					label: "Edit commands",
					hint: "tweak the generated commands",
				},
				{ value: "retry", label: "Retry", hint: "regenerate with same prompt" },
				{
					value: "edit-prompt",
					label: "Edit prompt",
					hint: "modify request and retry",
				},
				{ value: "copy", label: "Copy" },
				{ value: "cancel", label: "Cancel" },
			],
		});

		if (p.isCancel(action) || action === "cancel") {
			p.outro("Cancelled.");
			process.exit(0);
		}

		if (action === "retry") {
			({ result: currentResult, userRequest } = await generateUntilSuccess(
				userRequest,
				ctx,
				config,
			));
			renderPanels(currentResult);
		} else if (action === "edit-prompt") {
			({ result: currentResult, userRequest } = await handleEditPromptAction(
				userRequest,
				ctx,
				config,
			));
			renderPanels(currentResult);
		} else if (action === "copy") {
			await handleCopyAction(currentResult.commands);
		} else if (action === "edit") {
			currentResult = await handleEditCommandsAction(currentResult);
			renderPanels(currentResult);
		} else if (action === "run") {
			await handleRunAction(currentResult.commands);
		}
	}
}

// ── Main ──────────────────────────────────────────────────────────────────────

const subcommand = args[0];

if (subcommand === "setup") {
	await runSetup();
	process.exit(0);
} else if (subcommand === "teardown") {
	await runTeardown();
	process.exit(0);
} else {
	// First non-flag positional arg is the conversion request
	const request = args.find((a) => !a.startsWith("-"));

	// Config is loaded here so --provider override can be applied
	let config = await getConfig();

	if (providerOverride) {
		if (config) {
			config = { ...config, defaultProvider: providerOverride };
		} else {
			config = { defaultProvider: providerOverride };
		}
	}

	if (!config) {
		showBanner();
		p.log.error("No provider configured. Run: vicon setup");
		process.exit(1);
	}

	if (config.defaultProvider === "cloudflare" && !config.cloudflare) {
		showBanner();
		p.log.error("Cloudflare credentials missing. Run: vicon setup");
		process.exit(1);
	}

	showBanner();

	if (!request) {
		p.log.info("Usage: vicon <request>  |  vicon --help for more");
		process.exit(0);
	}

	await runConversion(request, config);
}

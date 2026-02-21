import type { GenerateResult } from "../types.js";
import type { CloudflareCredentials, AviconConfig } from "./config.js";

export const CF_MODEL = "@cf/openai/gpt-oss-120b";
export const CLAUDE_MODEL = "sonnet";

export class ValidationError extends Error {
	constructor(
		message: string,
		public readonly raw: string,
	) {
		super(message);
		this.name = "ValidationError";
	}
}

export function validateResponse(raw: string): GenerateResult {
	const cleaned = raw
		.trim()
		.replace(/^```(?:json)?\n?/, "")
		.replace(/\n?```$/, "");

	let parsed: unknown;
	try {
		parsed = JSON.parse(cleaned);
	} catch {
		throw new ValidationError("Invalid JSON response from AI", raw);
	}

	const obj = parsed as { commands?: unknown; explanation?: unknown };
	if (
		!Array.isArray(obj.commands) ||
		!obj.commands.every((c: unknown) => typeof c === "string") ||
		typeof obj.explanation !== "string"
	) {
		throw new ValidationError(
			"Response missing required fields: commands (string[]) and explanation (string)",
			raw,
		);
	}

	return { commands: obj.commands as string[], explanation: obj.explanation };
}

export async function generateWithCloudflare(
	systemPrompt: string,
	userPrompt: string,
	credentials: CloudflareCredentials,
): Promise<GenerateResult> {
	const response = await fetch(
		`https://api.cloudflare.com/client/v4/accounts/${credentials.accountId}/ai/v1/chat/completions`,
		{
			method: "POST",
			headers: {
				Authorization: `Bearer ${credentials.apiToken}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				model: CF_MODEL,
				messages: [
					{ role: "system", content: systemPrompt },
					{ role: "user", content: userPrompt },
				],
				response_format: { type: "json_object" },
				max_tokens: 2048,
			}),
		},
	);

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`Cloudflare API error ${response.status}: ${error}`);
	}

	const data = (await response.json()) as {
		choices?: { message?: { content?: string } }[];
	};

	const raw = data.choices?.[0]?.message?.content ?? "";
	return validateResponse(raw);
}

export async function generateWithClaude(
	systemPrompt: string,
	userPrompt: string,
): Promise<GenerateResult> {
	const combinedPrompt = `${systemPrompt}\n\n${userPrompt}`;
	const proc = Bun.spawn(
		["claude", "--model", CLAUDE_MODEL, "-p", combinedPrompt],
		{
			stdout: "pipe",
		},
	);
	const raw = (await new Response(proc.stdout).text()).trim();
	return validateResponse(raw);
}

export async function generate(
	systemPrompt: string,
	userPrompt: string,
	config: AviconConfig,
): Promise<GenerateResult> {
	if (config.defaultProvider === "cloudflare") {
		if (!config.cloudflare) {
			throw new Error(
				"Cloudflare credentials not configured. Run: avicon setup",
			);
		}
		return generateWithCloudflare(systemPrompt, userPrompt, config.cloudflare);
	}
	return generateWithClaude(systemPrompt, userPrompt);
}

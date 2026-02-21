import { CONFIG_KEY, SECRETS_SERVICE } from "./secrets.js";

export type Provider = "cloudflare" | "claude";

export interface CloudflareCredentials {
	accountId: string;
	apiToken: string;
}

export interface AviconConfig {
	defaultProvider: Provider;
	cloudflare?: CloudflareCredentials;
}

// Three-state cache: undefined = not yet loaded, null = nothing found, object = valid config
let _cache: AviconConfig | null | undefined;

export async function getConfig(): Promise<AviconConfig | null> {
	if (_cache !== undefined) return _cache;

	// Check env var first
	const envVal = process.env[CONFIG_KEY];
	if (envVal) {
		try {
			_cache = JSON.parse(envVal) as AviconConfig;
			return _cache;
		} catch {
			// Invalid JSON in env var — fall through
		}
	}

	// Try Bun.secrets
	try {
		const val = await Bun.secrets.get({
			service: SECRETS_SERVICE,
			name: CONFIG_KEY,
		});
		if (val) {
			_cache = JSON.parse(val) as AviconConfig;
			return _cache;
		}
	} catch {
		// Secret store unavailable — fall through
	}

	_cache = null;
	return null;
}

export async function setConfig(config: AviconConfig): Promise<void> {
	try {
		await Bun.secrets.set({
			service: SECRETS_SERVICE,
			name: CONFIG_KEY,
			value: JSON.stringify(config),
		});
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		if (
			msg.toLowerCase().includes("libsecret") ||
			msg.toLowerCase().includes("secret service")
		) {
			throw new Error(
				`Failed to store config in keychain: ${msg}\n` +
					`Install libsecret:\n` +
					`  Ubuntu/Debian: sudo apt install libsecret-1-0 libsecret-tools\n` +
					`  Fedora:        sudo dnf install libsecret\n` +
					`  Arch:          sudo pacman -S libsecret`,
			);
		}
		throw err;
	}
	_cache = config;
}

export async function deleteConfig(): Promise<void> {
	_cache = undefined;
	try {
		await Bun.secrets.delete({ service: SECRETS_SERVICE, name: CONFIG_KEY });
	} catch {
		// Not found — no-op
	}
}

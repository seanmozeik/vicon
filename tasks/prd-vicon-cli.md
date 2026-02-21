# PRD: vicon — AI-Powered Media Conversion CLI

## Introduction

`vicon` is a CLI tool that translates natural-language media conversion requests into runnable shell commands using AI. The user describes what they want in plain English; vicon detects installed tools and codecs, sends that context to the LLM, displays an explanation and the generated command(s) in clearly separated panels, and — after a single confirmation — runs them in series with live output streamed to the terminal.

**AI providers:** Cloudflare AI (`@cf/openai/gpt-oss-120b`, default) or Claude Code CLI (`claude --model sonnet`, no credentials needed if already installed)

**Supported media backends:** `ffmpeg`, `magick` (ImageMagick v7)

**Primary usage:**
```
vicon "convert all images in this dir from png to avif"
vicon "extract audio from video.mp4 as mp3 at 320kbps"
vicon "resize IMG_001.jpg to 1920px wide keeping aspect ratio"
vicon --provider claude "convert all images in this dir from png to avif"
```

---

## Goals

- Parse natural-language media conversion requests into one or more safe, copy-pasteable shell commands
- Inject real tool/codec context so the LLM generates accurate, working commands for the user's exact environment
- Always show the user a clear prose explanation (what and why) and the commands (what to run) in visually distinct panels before anything executes
- Show all commands upfront, confirm once, then run them all in series
- Stream live tool output to the terminal via `Bun.spawn`
- Fail safely: default to non-destructive flags, offer cleanup after execution
- Ship as a single compiled binary (`vicon`) via `bun build --compile`

---

## User Stories

### US-001: Project scaffold and dependencies
**Description:** As a developer, I need the project wired up with the correct dependencies, tsconfig, and build script so the rest of the work has a foundation.

**Acceptance Criteria:**
- [ ] `package.json` has `@clack/prompts`, `picocolors`, `boxen`, `gradient-string`, `figlet` installed via `bun install`
- [ ] `tsconfig.json` is strict-mode, targets `ESNext`, `moduleResolution: bundler`
- [ ] `bun run dev` runs `src/index.ts` with `--hot`
- [ ] `bun run build` produces a compiled binary `./vicon` via `bun build src/index.ts --compile --outfile vicon`
- [ ] Typecheck passes (`bunx tsc --noEmit`)

### US-002: AI client module (Cloudflare + Claude Code CLI)
**Description:** As a developer, I need a reusable AI module that supports both Cloudflare and the Claude Code CLI as backends, so all generation goes through one place regardless of provider.

**Acceptance Criteria:**
- [ ] `src/lib/ai.ts` exports:
  - `CF_MODEL = "@cf/openai/gpt-oss-120b"` — single constant, easy to swap
  - `CLAUDE_MODEL = "sonnet"` — single constant for the `--model` flag
  - `generateWithCloudflare(systemPrompt: string, userPrompt: string, config: CloudflareCredentials): Promise<GenerateResult>`
  - `generateWithClaude(systemPrompt: string, userPrompt: string): Promise<GenerateResult>`
  - `generate(systemPrompt: string, userPrompt: string, config: ViconConfig): Promise<GenerateResult>` — dispatches to the correct function based on `config.defaultProvider`
  - `validateResponse(raw: string): GenerateResult` — strips markdown code fences defensively, parses JSON, validates shape `{ commands: string[], explanation: string }`, throws typed error with raw text if invalid
- [ ] **Cloudflare path:** `fetch` to `https://api.cloudflare.com/client/v4/accounts/{accountId}/ai/v1/chat/completions` with `messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }]`, `response_format: { type: "json_object" }`, throws on non-200
- [ ] **Claude CLI path:** `Bun.spawn({ cmd: ["claude", "--model", CLAUDE_MODEL, "-p", combinedPrompt], stdout: "pipe" })` where `combinedPrompt` concatenates the system prompt and user request into a single string (CLI has no separate system role); reads stdout via `new Response(proc.stdout).text()`
- [ ] Both paths pipe their raw text response through `validateResponse` before returning
- [ ] `GenerateResult = { commands: string[], explanation: string }` exported from `src/types.ts`
- [ ] Typecheck passes

### US-003: Credential setup, storage, and provider selection
**Description:** As a user, I need to configure vicon once — choosing either Cloudflare (requires credentials) or Claude Code CLI (no credentials, uses the already-installed `claude` binary) — and have that choice persisted.

**Acceptance Criteria:**
- [ ] `src/lib/config.ts` exports:
  - `type Provider = 'cloudflare' | 'claude'`
  - `interface CloudflareCredentials { accountId: string; apiToken: string }`
  - `interface ViconConfig { defaultProvider: Provider; cloudflare?: CloudflareCredentials }` — `claude` needs no stored credentials
- [ ] `src/lib/secrets.ts` constants: `SECRETS_SERVICE = "com.vicon.cli"`, `CONFIG_KEY = "VICON_CONFIG"`
- [ ] Module-level cache: `let configCache: ViconConfig | null | undefined` — `undefined` = not yet loaded, `null` = loaded but nothing found, object = valid. Avoids multiple keychain prompts per process.
- [ ] `getConfig()`: (1) return cache if not `undefined`; (2) check `process.env["VICON_CONFIG"]` — parse as JSON if set (env var fallback for CI/headless); (3) `Bun.secrets.get({ name: CONFIG_KEY, service: SECRETS_SERVICE })`; parse and cache; return `null` on miss
- [ ] `setConfig(config: ViconConfig)`: `Bun.secrets.set({ name, service, value: JSON.stringify(config) })`; update cache; on Linux if error includes `"libsecret"`, throw helpful error with distro install commands (`sudo apt install libsecret-1-0` / `sudo dnf install libsecret` / `sudo pacman -S libsecret`)
- [ ] `deleteConfig()`: reset cache to `undefined` (not `null`); `Bun.secrets.delete({ name, service })`
- [ ] `vicon setup` flow:
  1. `p.select` — "Select AI provider": Cloudflare AI / Claude Code CLI
  2. If **Cloudflare**: collect `accountId` (`p.text`) and `apiToken` (`p.password`); save `{ defaultProvider: 'cloudflare', cloudflare: { accountId, apiToken } }`
  3. If **Claude**: run `which claude` via `Bun.spawn`; if exit code non-zero, print error "Claude CLI not found — install from claude.ai/download" and exit 1; if found, save `{ defaultProvider: 'claude' }` (no credentials stored)
- [ ] `vicon teardown`: `p.confirm` (default No) → `deleteConfig`
- [ ] At conversion time: if provider is `cloudflare` and `config.cloudflare` is missing → exit 1 with `No Cloudflare credentials. Run: vicon setup`; if provider is `claude`, no credential check needed
- [ ] `--provider cloudflare|claude` flag overrides `config.defaultProvider` for a single invocation
- [ ] Typecheck passes

### US-004: Tool/codec context detection
**Description:** As a developer, I need a module that detects installed tool versions and available codecs so the LLM can generate commands accurate to the user's environment.

**Acceptance Criteria:**
- [ ] `src/lib/tools.ts` exports `detectContext(): Promise<ToolContext>`
- [ ] `ToolContext` type (in `src/types.ts`): `{ ffmpeg: { installed: boolean, version?: string, encoders: string[], decoders: string[] }, magick: { installed: boolean, version?: string, formats: string[] } }`
- [ ] ffmpeg version: parse first line of `ffmpeg -version`; encoders: parse codec names from `ffmpeg -encoders`; decoders: `ffmpeg -decoders`
- [ ] magick version: parse first line of `magick -version`; formats: parse format names from `magick -list format`
- [ ] If a tool is not installed (process errors or not found), its entry has `installed: false` and empty arrays — does not throw
- [ ] Both detections run in parallel via `Promise.all`
- [ ] Result is cached for the lifetime of the process
- [ ] Typecheck passes

### US-005: System prompt and user prompt construction
**Description:** As a developer, I need a module that builds the system prompt and user prompt sent to the LLM, injecting tool context and enforcing strict JSON output structure with clear separation between explanation and commands.

**Acceptance Criteria:**
- [ ] `src/lib/prompt.ts` exports `buildSystemPrompt(ctx: ToolContext): string` and `buildUserPrompt(request: string): string`
- [ ] Prompt is composed as an array of `## SectionName\ncontent` blocks joined by `\n\n` — same pattern as the reference CLI's `buildPrompt` (sections are modular and easy to extend)
- [ ] Section order: `## Environment` → `## Rules` (Rules last so they're weighted most heavily by the model)
- [ ] `## Environment` section contains the serialized `ToolContext`:
  ```
  ffmpeg 7.1 | encoders: [codec, codec, ...] | decoders: [codec, ...]
  magick 7.1.1 | formats: [FMT, FMT, ...]
  ```
- [ ] `## Rules` section instructs the LLM to return **only** valid JSON with exactly two keys:
  - `"commands"`: array of strings — each element is a single, complete, copy-pasteable shell command. No placeholders (no `<input_file>`), no comments, no bash syntax (no `&&`, `;`, loops, subshells)
  - `"explanation"`: plain-English prose **only** — no shell commands, no code, no backticks, no technical syntax. 2-4 sentences: what the commands do, which flags are used and why, what the output will be
- [ ] Rules section ends with strong imperative: `IMPORTANT: Reply with ONLY the JSON object. No markdown, no code fences, no text before or after the JSON.`
- [ ] Rules also instruct: only use tools marked installed in Environment; prefer non-destructive output (`_converted` suffix, `-n` flag); produce multiple commands for batch tasks
- [ ] `src/lib/ai.ts` exports `validateResponse(raw: string): GenerateResult` that: strips markdown code fences (` ```json ``` ` wrapping) defensively, parses JSON, validates `commands` is `string[]` and `explanation` is `string`, throws typed error with raw text if invalid — same defensive pattern as `validateMessage` in reference
- [ ] Typecheck passes

### US-006: Tool context display
**Description:** As a user, I want to see which tools were detected in my environment so I know what vicon will be working with.

**Acceptance Criteria:**
- [ ] After the "Detecting tools…" spinner resolves, print a compact summary line before the AI spinner starts
- [ ] Format: `ffmpeg 7.1 (142 encoders · 156 decoders)  ·  magick 7.1.1 (210 formats)` in muted/subtext theme color
- [ ] If a tool is not installed, show it as `ffmpeg not found` in warning/yellow color
- [ ] Printed via `p.log.info` (clack), not raw `console.log`
- [ ] Typecheck passes

### US-007: Banner and theme
**Description:** As a developer, I need the Catppuccin Frappe theme and ASCII banner ported to vicon so the UI is consistent and polished.

**Acceptance Criteria:**
- [ ] `src/ui/theme.ts` — full Catppuccin Frappe palette + semantic aliases, adapted from reference CLI
- [ ] `src/ui/banner.ts` — exports `showBanner()` displaying "VICON" in ANSI Shadow font with mauve→pink→flamingo gradient
- [ ] Banner renders without errors in terminal
- [ ] Typecheck passes

### US-008: Main conversion flow — display
**Description:** As a user, I want to run `vicon "my request"` and see a clear explanation and all commands before being asked to run them.

**Acceptance Criteria:**
- [ ] Entry point: `vicon "<natural language request>"` (first positional argument after subcommand check)
- [ ] Full display flow:
  1. `showBanner()`
  2. Spinner: "Detecting tools…" → stop → print tool summary (US-006)
  3. Spinner: "Generating command…" → AI call
  4. Display **Explanation panel** then **Commands panel** (see boxen spec below)
  5. Action menu (`p.select`): **Run all** / **Edit** / **Copy** / **Cancel**
- [ ] **Explanation panel** — primary, full attention:
  ```ts
  boxen(frappe.text(explanation), {
    borderColor: boxColors.primary,   // mauve
    borderStyle: 'round',
    padding: { bottom: 1, left: 2, right: 2, top: 1 },
    title: 'What this does',
    titleAlignment: 'center'
  })
  ```
- [ ] **Commands panel** — secondary, dimmed border:
  ```ts
  boxen(commandLines, {
    borderColor: boxColors.default,   // surface2 / grey
    borderStyle: 'round',
    dimBorder: true,
    padding: { bottom: 0, left: 1, right: 1, top: 0 },
    title: 'Commands',
    titleAlignment: 'left'
  })
  ```
  where `commandLines` is commands numbered `[1] ffmpeg ...` / `[2] magick ...`, each line in `frappe.sky` or similar code color
- [ ] `boxColors`, `frappe`, `boxen` options are the same API the reference uses in `context-panel.ts` — adapt directly
- [ ] Single command still goes through the Commands panel unchanged (no special-casing)
- [ ] Typecheck passes

### US-009: Edit and copy actions
**Description:** As a user, I want to be able to edit or copy the commands before running them.

**Acceptance Criteria:**
- [ ] "Edit": opens a `p.text` field pre-filled with all commands joined by `\n`; on submit, re-renders both panels with updated commands and re-shows the action menu
- [ ] "Copy": copies all commands joined by `\n` to clipboard via `src/lib/clipboard.ts`; prints success/failure message and exits
- [ ] "Cancel": calls `p.outro` with a neutral message and exits 0
- [ ] `src/lib/clipboard.ts` implementation (lifted directly from reference):
  - macOS: `Bun.spawn(['pbcopy'], { stdin: 'pipe' })` → `proc.stdin.write(text); proc.stdin.end()` — do NOT shell pipe, write directly to stdin
  - Linux: iterate `[['xclip', '-selection', 'clipboard'], ['xsel', '--clipboard', '--input'], ['wl-copy']]`; for each, probe with `` await Bun.$`which ${cmd[0]}`.quiet() ``; on `exitCode === 0` spawn with `stdin: 'pipe'` and write text; break on first success
  - Returns `boolean` — `true` if copied, `false` if no tool found
  - Caller prints warning if `false`: "No clipboard tool found. Install xclip, xsel, or wl-copy."
- [ ] Typecheck passes

### US-010: Command execution with live output
**Description:** As a user, once I confirm "Run all", I want all commands to run in series with live output visible so I can monitor progress.

**Acceptance Criteria:**
- [ ] On "Run all": iterate all commands in series — no further prompts between commands
- [ ] Before each command, print: `▶ [1/N] <command>` in theme accent color via `p.log.step`
- [ ] Each command executes via `Bun.spawn({ cmd: ["sh", "-c", command], stdout: "inherit", stderr: "inherit" })` — inherited stdio streams live to the terminal (unlike reference's `aic-script.ts` which uses `"pipe"`; we want live output, not captured output)
- [ ] `await proc.exited` before starting the next command
- [ ] If a command exits non-zero: stop the series, print exit code via `p.log.error`, proceed to cleanup (US-011)
- [ ] After all exit 0: `p.log.success`, proceed to cleanup
- [ ] `src/lib/run.ts` exports `runCommands(commands: string[], options: { onBefore: (i, n, cmd) => void, onSuccess: () => void, onError: (exitCode, cmd) => void }): Promise<boolean>` — callback-based like `executeSection` in reference, keeps execution logic decoupled from UI
- [ ] Typecheck passes

### US-011: Post-run cleanup prompt
**Description:** As a user, after a conversion run I want the option to delete the original input files so my directory stays tidy.

**Acceptance Criteria:**
- [ ] After run completes (success or partial failure), attempt to infer input filenames from the commands array (look for common media extensions: `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.avif`, `.mp4`, `.mov`, `.mkv`, `.mp3`, `.wav`, `.flac`, `.aac`)
- [ ] If at least one input file is inferred:
  - Print the list of inferred files
  - `p.confirm`: "Delete original files?" — default **No**
  - If confirmed: delete each with `` Bun.$`rm ${file}` ``; log per-file success/failure
- [ ] If no input files can be inferred, skip the cleanup prompt silently
- [ ] Typecheck passes

### US-012: `--help` and `--version` flags
**Description:** As a user, I want standard CLI help and version flags.

**Acceptance Criteria:**
- [ ] `vicon --help` / `-h` prints banner, usage, subcommands, and 3 example invocations, then exits 0
- [ ] `vicon --version` / `-v` prints version from `package.json` (embedded at compile time), then exits 0
- [ ] Typecheck passes

---

## Functional Requirements

- **FR-1:** Accept a single quoted string as the conversion request (`Bun.argv[2]` after subcommand handling)
- **FR-2:** Store Cloudflare credentials in the system keychain via `Bun.secrets`
- **FR-3:** Detect ffmpeg and magick availability, versions, and codecs/formats in parallel before every AI call
- **FR-4:** Build and send a system prompt that enforces `{ commands: string[], explanation: string }` JSON with strict separation of prose vs. commands
- **FR-5:** Parse LLM response as `{ commands, explanation }`; if JSON parsing fails, show raw output and exit 1
- **FR-6:** Always display explanation panel (prose) and commands panel (code) in visually distinct `boxen` boxes
- **FR-7:** Show all commands upfront, one "Run all" confirmation, then run in series — no per-command prompts
- **FR-8:** Stream live process output via `Bun.spawn` with inherited stdio
- **FR-9:** Offer cleanup (delete inferred originals) after execution, defaulting to No
- **FR-10:** Compile to a standalone binary via `bun build --compile`
- **FR-11:** All AI calls go through `src/lib/ai.ts`; model is the single constant `CF_MODEL`

---

## Non-Goals

- No bash script generation — multiple standalone commands run in series is sufficient
- No directory scanning or file listing injected into prompts (user names files explicitly in the request)
- No GUI or web interface
- No multi-provider support (Cloudflare only for now)
- No history / undo of past conversions
- No streaming of LLM response (spinner until complete, then display)
- No video editing beyond what ffmpeg supports natively

---

## Technical Considerations

- **Runtime:** Bun only. No Node.js APIs.
- **Providers:**
  - `cloudflare` (default): `POST /client/v4/accounts/{accountId}/ai/v1/chat/completions`, model `CF_MODEL = "@cf/openai/gpt-oss-120b"`, uses `response_format: { type: "json_object" }`
  - `claude`: `Bun.spawn(["claude", "--model", CLAUDE_MODEL, "-p", combinedPrompt])`, model `CLAUDE_MODEL = "sonnet"`, no credentials needed — relies on the user having Claude Code CLI installed and authenticated
- **JSON enforcement:** `response_format: json_object` for Cloudflare; system prompt instruction + `validateResponse` code-fence stripping for both paths
- **Credential storage:** `Bun.secrets` (libsecret on Linux, Keychain on macOS); `VICON_CONFIG` env var as CI fallback
- **Media process execution:** `Bun.spawn({ cmd: ["sh", "-c", command], stdout: "inherit", stderr: "inherit" })`
- **Clipboard:** Shell out to `pbcopy` / `xclip` / `xsel` / `wl-copy`
- **Build:** `bun build src/index.ts --compile --outfile vicon --minify`
- **UI library:** `@clack/prompts` for all prompts, spinners, and log messages
- **Reference codebase:** `/tmp/imports` — lift/adapt these directly:
  - `src/lib/secrets.ts` → vicon `secrets.ts` (three-state cache, env var fallback, libsecret error handling)
  - `src/lib/ai.ts` → vicon `ai.ts` (Cloudflare fetch shape, claude spawn shape, validateMessage → validateResponse)
  - `src/lib/clipboard.ts` → vicon `clipboard.ts` (verbatim — pbcopy stdin write, Bun.$ which probe pattern)
  - `src/lib/aic-script.ts` `executeSection` → vicon `run.ts` `runCommands` (callback shape, `sh -c` spawn — change stdout/stderr from `"pipe"` to `"inherit"` for live output)
  - `src/ui/theme.ts` → vicon `theme.ts` (verbatim Catppuccin Frappe palette)
  - `src/ui/banner.ts` → vicon `banner.ts` (change figlet text from `"AIC"` to `"VICON"`)
  - `src/ui/context-panel.ts` `boxen(...)` call signatures → vicon `ui/panels.ts` (adapt the boxen option shapes for Explanation + Commands panels; drop the git/file-diff display logic)

---

## File Structure

```
src/
  index.ts           # CLI entry: arg parsing, subcommand routing, main flow
  types.ts           # Shared types: GenerateResult, CloudflareConfig, ToolContext
  lib/
    ai.ts            # Cloudflare AI client; CF_MODEL constant
    secrets.ts       # Bun.secrets CRUD for credentials
    tools.ts         # ffmpeg/magick version + codec/format detection
    prompt.ts        # buildSystemPrompt() + buildUserPrompt()
    clipboard.ts     # Cross-platform copy-to-clipboard
    run.ts           # Bun.spawn command runner with live output + cleanup
  ui/
    theme.ts         # Catppuccin Frappe palette + semantic aliases
    banner.ts        # ASCII "VICON" banner with gradient
```

---

## Success Metrics

- User can go from cold install to first successful conversion in under 2 minutes
- LLM-generated commands run without modification in >80% of common use cases
- Explanation panel contains only prose — never shell syntax
- Commands panel contains only executable commands — never prose
- No original files are deleted without explicit user confirmation

---

## Open Questions

- Should the cleanup prompt list inferred files and ask "are these the right files?" before offering to delete, or just delete after a single confirm?
- Should `vicon` warn if neither ffmpeg nor magick is installed (nothing to work with)?

# avicon

**A**udio **V**ideo **I**mage **Con**verter — describe what you want, get the shell commands.

Avicon is a CLI that turns plain-English media requests into executable FFmpeg and ImageMagick commands. It detects your installed tools and their capabilities, sends your request to an AI provider, and presents the generated commands for review before running them.

```bash
avicon "convert video.mp4 to gif at 15fps"
```

```
╭──────────── What this does ────────────╮
│                                        │
│  Converts your MP4 to an animated GIF  │
│  at 15 frames per second.              │
│                                        │
╰────────────────────────────────────────╯

╭ Commands ──────────────────────────────╮
│ [1] ffmpeg -i video.mp4 -vf "fps=15,  │
│     scale=480:-1" video_converted.gif  │
╰────────────────────────────────────────╯

◆  What would you like to do?
│  ● Run all
│  ○ Edit commands
│  ○ Retry
│  ○ Edit prompt
│  ○ Copy
│  ○ Cancel
└
```

## Install

Requires [Bun](https://bun.sh).

**Homebrew:**

```bash
brew install seanmozeik/tap/avicon
```

**npm:**

```bash
bun add -g @seanmozeik/avicon
```

**From source:**

```bash
git clone https://github.com/seanmozeik/avicon.git
cd avicon
bun install
bun run build          # compiled binary → ./avicon
bun run install-local  # moves binary to ~/.local/bin
```

## Setup

Run `avicon setup` to configure your AI provider.

**Cloudflare AI** requires an account ID and API token. Credentials are stored in your system keychain (macOS Keychain, Linux libsecret).

**Claude Code CLI** requires the `claude` binary on your PATH. No additional credentials needed.

```bash
avicon setup
```

```
◆  Which AI provider?
│  ● Cloudflare AI (requires Account ID + API token)
│  ○ Claude Code CLI (requires claude CLI installed)
└
```

For headless or CI environments, set the `AVICON_CONFIG` environment variable:

```bash
export AVICON_CONFIG='{"defaultProvider":"cloudflare","cloudflare":{"accountId":"...","apiToken":"..."}}'
```

Linux users need libsecret for keychain storage:

```bash
# Ubuntu/Debian
sudo apt install libsecret-1-0 libsecret-tools

# Fedora
sudo dnf install libsecret

# Arch
sudo pacman -S libsecret
```

## Usage

```bash
avicon "<your request>"
```

Avicon detects FFmpeg and ImageMagick on startup, inventories their codecs, filters, and supported formats, and feeds this context to the AI. The generated commands match your actual environment.

### Examples

```bash
# Video
avicon "convert video.mp4 to gif at 15fps"
avicon "extract audio from interview.mov as flac"
avicon "compress this 4K video to 1080p h265 with good quality"

# Images
avicon "resize all jpgs in this folder to 800px wide"
avicon "convert logo.png to webp and avif"
avicon "strip EXIF data from every image in ./photos"

# Audio
avicon "split podcast.mp3 into 30-minute chunks"
avicon "normalize volume across all wav files here"
```

### Actions

After generation, you choose what happens next:

| Action | Effect |
|---|---|
| **Run all** | Executes each command in sequence with live terminal output |
| **Edit commands** | Opens the commands in a text editor for manual tweaks |
| **Retry** | Regenerates with the same prompt |
| **Edit prompt** | Modifies your request and regenerates |
| **Copy** | Copies all commands to clipboard |
| **Cancel** | Exits |

### Provider override

Force a specific provider for one invocation:

```bash
avicon "resize photo.jpg to 50%" --provider claude
```

### Post-run cleanup

After commands finish, avicon scans for media files referenced in the commands and offers to delete the originals. The default is No.

```
ℹ  Input files detected:
     video.mp4
◆  Delete original files?
│  ○ Yes / ● No
└
```

### Error recovery

If the AI returns an unparseable response, avicon shows the raw output and offers three paths: retry with the same prompt, edit your prompt and retry, or cancel. This loop continues until you get a valid result or walk away.

## Flags

```
--provider cloudflare|claude   Override the default provider
--help, -h                     Show usage and examples
--version, -v                  Print version
```

## Subcommands

```
setup       Configure AI provider credentials
teardown    Remove saved credentials from keychain
```

## Tool detection

On each run, avicon probes for:

- **FFmpeg**: version, codecs, filters, bitstream filters, formats
- **ImageMagick**: version, supported format list

This context goes into the system prompt so the AI only generates commands your system can execute. If a tool is missing, avicon warns you and the AI works around it.

## How it works

1. Parse your request and detect installed tools
2. Build a system prompt containing tool versions, codecs, and formats
3. Send the request to Cloudflare AI or Claude Code CLI
4. Parse the JSON response into commands and a plain-English explanation
5. Display both in separate panels for review
6. Execute, edit, retry, copy, or cancel

Generated commands use safe defaults: output files get a `_converted` suffix, existing files are never overwritten silently.

## Development

```bash
bun install
bun --hot src/index.ts    # dev mode with hot reload
bun test                  # run tests
bun run build             # compile to standalone binary
```

## License

MIT

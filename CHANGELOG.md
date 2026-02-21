# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.1] - 2026-02-21

### Added
- Add separate video and audio encoders in ffmpeg to give users more precise control over media conversion.
- Add an expanded system prompt to provide clearer guidance and enhance the overall user experience.

## [0.1.0] - 2026-02-21

### Added
- Add AI generation support with configurable maximum token count.
- Add an interactive post‑run cleanup prompt that detects created files and offers deletion.
- Add an action menu that lets you copy results, edit prompts, or run conversions in series.
- Add enhanced UI panels that summarise available tools and display conversion outputs.
- Add automatic detection of file type and codec to generate more accurate conversion prompts.
- Add integrated AI clients for Cloudflare and Claude Code CLI.

### Changed
- Update the conversion flow to route arguments more effectively and show a concise tool summary.
- Update the user interface with a new theme and clearer panels for a polished look.
- Update provider setup to simplify configuration of Cloudflare credentials and secrets.


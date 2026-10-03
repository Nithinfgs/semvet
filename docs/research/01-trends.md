# Research: what is spreading on GitHub (3 October 2026)

Method: GitHub Trending (weekly), the HN front page and Show HN via the Algolia API, Trendshift's monthly list,
a daily-trending digest, and web searches on developer pain points. Star counts and dates below were read from
those sources on 2026-10-03 (README facts via `gh api repos/<repo>/readme`). Fields marked "not examined" were
not looked at; nothing here is filled in from memory.

## Themes

1. **Coding agents are the center of gravity.** Of the weekly trending list, most entries are agent infrastructure
   (agent memory, agent skills, agents that browse, agents that render video).
2. **Cost and context are the new pain.** Developers complain about token spend, bloated instruction files and
   black-box context use. A cottage industry of "reduce tokens" tools has appeared (Headroom ~30k stars,
   Graphify, Caveman, ...).
3. **Local-first and self-hosted wins attention.** Fully local voice, local LLM runners, offline scanners.
4. **Small, sharp CLIs spread on a one-line install.** `yoinks` reached ~3.7k stars in under three weeks
   with a 3 KB README; `jevgrep` reached ~2.1k in a week.
5. **Skills / instruction packs are a distribution format**, installed with `npx skills add ...`.
6. **Supply-chain and config safety** (MCP server scanners, hook scanners) are a steady second theme.

## Projects analysed

| # | Repo | What it does | Stars (+7d) | Created | Stack | Install | Why it spreads | Gap / weakness |
|---|------|--------------|-------------|---------|-------|---------|----------------|----------------|
| 1 | paperclipai/paperclip | Control plane for managing agents "at work" | 96.6k (+12.8k) | 2026-03 | TypeScript, MIT | `npx paperclipai@latest onboard --yes` | Big framing ("what X is not" section), 17 images, one-line onboard | Broad scope; heavy to evaluate |
| 2 | vectorize-io/hindsight | Long-term memory for agents | 44.9k (+16.2k) | 2025-10 | Python, MIT | `pip install hindsight-api` | Benchmarks section, 3-verb mental model (retain/recall/reflect) | Cloud-first default |
| 3 | debpalash/VoiceStudio | Local ElevenLabs alternative | 52.3k (+16.5k) | n/e | Python | not examined | "fully local" + big capability claim | not examined |
| 4 | pbakaus/impeccable | Design-quality skill pack for agents | 74.8k (+3.1k) | 2025-11 | JS, Apache-2.0 | `npx impeccable install` | Zero-image README, pure utility, many agent targets | Taste-dependent, hard to verify |
| 5 | heygen-com/hyperframes | "Write HTML, render video" for agents | 56.2k (+2.7k) | 2026-03 | TS, Apache-2.0 | `npx skills add heygen-com/hyperframes` | Vivid demos (17 images), comparison table | Vendor-driven |
| 6 | Panniantong/Agent-Reach | Gives agents web/social read access | 89.4k (+4.0k) | 2026-02 | Python, MIT | pip | Clear "why star" section, sponsor row | Depends on shell exec permissions |
| 7 | dzhng/jevgrep | Find code by asking what it does (CLI for agents) | 2.1k | 2026-09-26 | TS, MIT | `npm i -g @dzhng/jevgrep` | One sentence pitch, "What we measured" section | Requires a hosted inference service |
| 8 | pablostanley/yoinks | Download any video from the terminal | 3.7k | 2026-07-16 | TS, MIT | `npx yoinks` | Zero friction, tiny README, memorable name | Legal grey area (has a fair-use note) |
| 9 | agent-sh/agnix | Linter/LSP for CLAUDE.md, AGENTS.md, SKILL.md, hooks, MCP | 439 | 2026-01 | Rust, Apache-2.0 | `npx agnix .` | 456 rules, all-IDE plugins | Very broad; shallow checks per rule |
| 10 | coucou | Notch/taskbar monitor for Claude Code sessions | 1.8k (daily list) | n/e | Swift | n/e | Ambient, visual, tiny | Platform-specific |
| 11 | dots | Agent with its own browser | 2.0k (daily list) | n/e | Python | n/e | Novel framing | Detection-evasion angle is dual-use |
| 12 | Headroom | Context compression proxy for agents | ~30.7k | n/e | n/e | proxy/wrapper/MCP | Directly attacks the cost pain | Needs infrastructure |
| 13 | moli (lexmount) | Rust headless browser for agents | 2.8k (monthly) | n/e | Rust | n/e | Performance story | Narrow audience |
| 14 | tester-army/e2e | AI-powered e2e testing | 2.0k (monthly) | n/e | n/e | n/e | Pain is universal | LLM-dependent |
| 15 | Strata | Big local MoE model on consumer GPU | 4.6k (monthly) | n/e | n/e | one-click installer | Concrete hardware promise | Hardware-specific |
| 16 | Bumblebee (Perplexity) | MCP server security scanner | ~5k | 2026-05 | n/e | n/e | Security + big-company credibility | MCP only |
| 17 | OpenClaw | Self-hosted agent across chat apps | 188k (claimed in a roundup) | 2026 | n/e | n/e | Fastest-growing project reported | Not verified here |

(n/e = not examined.)

## README patterns that correlate with attention

- A **one-command install** appears in nearly every fast mover (`npx ...`).
- The strongest READMEs state **what the project is not** (paperclip) or **what was actually measured**
  (jevgrep, hindsight), which builds credibility.
- Image-heavy (hyperframes, paperclip) and image-free (impeccable) both work; what matters is that the
  first screen explains the value without scrolling.
- Tiny tools with a clear single verb (yoinks, jevgrep) get shared more than platforms.

## What was ruled out, and why

While auditing the target GitHub account I found it already contains many tools in the "coding-agent session
analysis / AGENTS.md linting" space (e.g. sessionscope, ctxrent, chafe, unstuck, agentrot, told-twice, onopen).
Building another one would duplicate existing work, so that whole area was excluded despite being the loudest
trend. Two other candidate areas were checked and found crowded with many near-identical young projects:
log/PII redaction before pasting into an LLM (shush, redactor, several "pastesafe" repos) and `.env` drift
checkers (a dozen small `envdrift`-style repos).

## Sources

- GitHub Trending (weekly) and Trendshift monthly list, read 2026-10-03
- Hacker News front page and Show HN via `hn.algolia.com`, read 2026-10-03
- Daily trending digest (marc-ko/daily-trending-repo issue 567)
- Pinggy, "8 Open Source Tools to Slash AI Coding Agent Token Usage in 2026"
- The Register and Gartner, June 2026, on AI coding costs
- README text of paperclip, hindsight, jevgrep, agnix, yoinks, impeccable, hyperframes, Agent-Reach (GitHub API)

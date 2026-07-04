# claude-code-statusline

> **Recommended install**: via [MuseLinn/muselinn-garage](https://github.com/MuseLinn/muselinn-garage) — one marketplace for all your Claude Code tools.

A [Claude Code](https://code.claude.com/) statusline plugin with Anthropic-warm palette, supporting DeepSeek, opencode go, and Anthropic providers. Pac-Man progress bar, git porcelain, code churn.

```
⦗●●●●ᗧ•••••⦘ 73% │ 384.2K/1.0M │ ¥0.0092 │ +10740 -23
main +1M·1A │ ~/project │ Fable → deepseek-v4-pro ⚡max │ ¥18.50 │ 14:32
5h ‹⣿⣿⣿⡟⠀› 50% ⇢ 3h  wk ‹⣿⣿⡟⠀⠀› 25% ⇢ 1d  mo ‹⣿⡟⠀⠀⠀› 12% ⇢ 19d
```

## Features

| Feature | DeepSeek | opencode go | Anthropic |
|---|---|---|---|
| Rainbow model animation (per-char TrueColor) | ✅ | ✅ | ✅ |
| Context bar (Pac-Man with rainbow track) | ✅ | ✅ | ✅ |
| Braille quota bar (‹…› with ⬌ borders) | — | ✅ | — |
| Token counts (in/out) | ✅ | ✅ | ✅ |
| Cache hit % | ✅ | — | — |
| Cost tracking (¥) | ✅ | — | — |
| Balance (DeepSeek API) | ✅ | — | — |
| Subscription usage (5h/wk/mo) | — | ✅ | — |
| Model tier badge (Sonnet → xxx) | ✅ | ✅ | ✅ |
| Git branch + porcelain status | ✅ | ✅ | ✅ |
| Repo link (OSC 8 clickable) | ✅ | ✅ | ✅ |
| Session name / Agent prefix | ✅ | ✅ | ✅ |
| Effort indicator | ✅ | ✅ | ✅ |
| Code churn (+N/-N) | ✅ | ✅ | ✅ |
| Vim mode / Worktree / PR | ✅ | ✅ | ✅ |

## Requirements

- [Claude Code](https://code.claude.com/) v2.1.132+
- Node.js 18+

## Installation

### Via plugin marketplace

```bash
claude plugin marketplace add MuseLinn/muselinn-garage
claude plugin install claude-code-statusline
/claude-code-statusline:setup
```

Restart Claude Code.

### Manual (copy file)

```bash
git clone https://github.com/MuseLinn/claude-code-statusline
cp claude-code-statusline/statusline.js ~/.claude/statusline.js
```

Then add to `~/.claude/settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "node ~/.claude/statusline.js"
  }
}
```

### Windows (Git Bash / MSYS2)

```json
{
  "statusLine": {
    "type": "command",
    "command": "\"C:\\Program Files\\nodejs\\node.exe\" \"C:\\Users\\<username>\\.claude\\statusline.js\""
  }
}
```

## Configuration

### DeepSeek

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://api.deepseek.com/anthropic",
    "ANTHROPIC_AUTH_TOKEN": "sk-your-deepseek-key"
  }
}
```

### opencode go

Create `~/.claude/statusline-config.json` (survives `/model` switches):

```json
{
  "OPENCODE_GO_ENABLED": "true",
  "OPENCODE_GO_AUTH_COOKIE": "Fe26.2**...",
  "OPENCODE_GO_WORKSPACE_ID": "wrk_..."
}
```

Get the cookie: visit https://opencode.ai, sign in, DevTools → Application → Cookies → copy `auth` value.

### Anthropic

No additional config needed.

## Agent panel (subagent status line)

The plugin also includes a `subagent-statusline.js` for the [agent panel](https://code.claude.com/docs/en/statusline#subagent-status-lines). It replaces the default agent row with a formatted badge showing agent type, status, elapsed time, and token count.

```
[Explore] Search codebase for API patterns   ▶ 5.2K tok
[Plan]    Design architecture                ✓ 12.4K tok
```

Add to `~/.claude/settings.json`:

```json
{
  "subagentStatusLine": {
    "type": "command",
    "command": "\"C:\\Program Files\\nodejs\\node.exe\" \"C:\\Users\\<username>\\.claude\\subagent-statusline.js\""
  }
}
```

The setup command (`/claude-code-statusline:setup`) installs this automatically.

## How it works

1. Claude Code pipes session JSON to the script via stdin (refreshInterval: 3s)
2. Script renders model, context bar (Pac-Man), tokens, git, etc.
3. Session state persisted in `~/.claude/deepseek-cache.json`, auto-cleaned after 7 days
4. DeepSeek: balance fetched from `/user/balance`, cached 5 min
5. opencode go: usage scraped from workspace page, cached 10s

## License

MIT

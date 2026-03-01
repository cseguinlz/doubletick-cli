# DoubleTick CLI

Open-source CLI and MCP server for email read tracking via Gmail. Know when your emails are opened — from the terminal.

Works with the [DoubleTick](https://doubletickr.com) backend. Tracks from the CLI show up alongside tracks from the Chrome extension.

## Install

```bash
npm install -g doubletick-cli
```

## Quick Start

```bash
# 1. Log in with your Gmail account (one-time)
doubletick login

# 2. Send a tracked email
doubletick send --to jane@company.com --subject "Q1 Planning" --body "Hi Jane, here are the numbers..."

# 3. Check if they read it
doubletick status --last
```

## Commands

### `doubletick login`

Authenticate with Gmail and DoubleTick. Opens your browser for Google sign-in. One-time setup — credentials are stored locally in `~/.doubletick/credentials.json`.

### `doubletick logout`

Remove stored credentials.

### `doubletick send`

Send a tracked email. Injects a read-tracking pixel, sends via Gmail API, and registers the track.

```bash
# Send a tracked email (body is markdown by default)
doubletick send --to jane@co.com --subject "Hi" --body "Hello **Jane**"

# HTML body instead of markdown
doubletick send --to jane@co.com --subject "Hi" --body "<h1>Hello</h1>" --html

# Body from file
doubletick send --to jane@co.com --subject "Hi" --body-file ./email.md

# With CC/BCC
doubletick send --to jane@co.com --cc "bob@co.com" --subject "Hi" --body "Hello"
```

### `doubletick status`

Check if a tracked email has been opened.

```bash
# Most recent tracked email
doubletick status --last

# Find by recipient
doubletick status --to jane@company.com

# By tracking ID
doubletick status abc-123
```

### `doubletick dashboard`

List all your tracked emails with open rates and stats.

```bash
doubletick dashboard
doubletick dashboard --limit 50
```

## MCP Server

DoubleTick works as an [MCP server](https://modelcontextprotocol.io) so AI agents (Claude Code, Claude Desktop, etc.) can send and track emails natively.

### Setup

Add to your Claude configuration:

```json
{
  "mcpServers": {
    "doubletick": {
      "command": "node",
      "args": ["/path/to/doubletick-cli/mcp-server.js"]
    }
  }
}
```

You must run `doubletick login` first — the MCP server uses the same stored credentials.

### Tools

| Tool | Description |
|------|-------------|
| `send_tracked_email` | Send an email with read tracking |
| `check_tracking_status` | Check if a tracked email has been opened |
| `list_tracked_emails` | List recent tracked emails with stats |

## How It Works

1. You compose an email (text or markdown)
2. The CLI converts it to HTML, generates a tracking ID, and injects a 1x1 tracking pixel
3. The email is sent via the Gmail API
4. The track is registered with DoubleTick's backend
5. When the recipient opens the email, the pixel fires and the open is logged
6. You check the status via `doubletick status`

The entire DoubleTick backend (pixel serving, open logging, deduplication, device detection) works unchanged. The CLI is just a new way to inject the pixel — replacing the Chrome extension's role for terminal/agent workflows.

## Architecture

```
doubletick CLI / MCP server
  ├── Gmail API        → send emails
  └── DoubleTick API   → register tracks, check status
        ├── GET  /img?t=<id>   → tracking pixel
        ├── POST /track        → register tracked email
        ├── GET  /status?id=   → check opens
        └── GET  /dashboard    → list tracked emails
```

## Requirements

- Node.js 18+
- A Gmail account
- A [DoubleTick](https://doubletickr.com) account (free tier: 5 tracked emails/week)

## License

MIT

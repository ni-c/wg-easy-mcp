# vhs script for the demo GIF: `vhs docs/demo.tape` writes public/demo.gif
#
# Prerequisites:
#   * vhs installed (https://github.com/charmbracelet/vhs)
#   * the server built (npm run build) and a reachable wg-easy v15 instance
#   * export WG_EASY_URL / WG_EASY_USERNAME / WG_EASY_PASSWORD before running
#   * run from the repository root, not from docs/
#
# Only read-only tools are recorded on purpose — this points at a real VPN.
#
# Rules learned the hard way:
#   * inside Hide blocks use vhs's own `Sleep`, never the shell's — shell sleep
#     blocks and the tape ends before any output is recorded
#   * MCP meta-tools need `arguments: {}` explicitly; it cannot be omitted
#   * start from the running server, do not record the setup

Output docs/public/demo.gif

Set FontSize 16
Set Width 1200
Set Height 640
Set Padding 20
Set Theme "Catppuccin Mocha"

Hide
Type "clear" Enter
Sleep 500ms
Show

Type "# WG_EASY_URL / _USERNAME / _PASSWORD are already exported" Enter
Sleep 1s
Type "# 1. what does the server expose?" Enter
Sleep 1s
Type "npx -y @modelcontextprotocol/inspector --cli node dist/index.js --method tools/list | jq -r '.tools[].name'" Enter
Sleep 6s
Type "# 2. list the VPN clients (read-only)" Enter
Sleep 1s
Type "npx -y @modelcontextprotocol/inspector --cli node dist/index.js --method tools/call --tool-name list_clients | head -20" Enter
Sleep 8s

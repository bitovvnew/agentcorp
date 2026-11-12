# Security

AgentCorp accepts API keys through environment variables or local setup. Setup stores credentials in `.agentcorp/config.json` (or the directory set by `AGENTCORP_HOME`). The application uses a Git-ignored directory and owner-only file permissions on systems that support them. Use environment variables if you prefer to keep keys out of the config file.

The dashboard listens on loopback by default. Write requests require a custom header and the server rejects non-loopback Host headers. Key values are masked in setup responses and redacted from provider errors before those errors reach logs or replays.

To report a vulnerability, open a private security advisory on GitHub (Security → Report a vulnerability) rather than a public issue.

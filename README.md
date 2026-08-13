# LinkedIn MCP Server

A local-first MCP server for LinkedIn's official OAuth and REST APIs. Each user
runs their own instance and supplies their own LinkedIn Developer application
credentials.

## Current capabilities

- Connect a LinkedIn member account with 3-legged OAuth.
- Read the authenticated member's OpenID profile and email.
- Publish a confirmed text post as the authenticated member.

The server uses only LinkedIn's official APIs. It does not scrape LinkedIn pages, use browser cookies, search arbitrary people, read messages, or export connections.

LinkedIn API access is controlled by LinkedIn. A public copy of this project
does not provide API access or bypass LinkedIn permissions. Users must create
and configure their own LinkedIn Developer application.

## Prerequisites

1. Create a LinkedIn Developer application.
2. Enable **Sign In with LinkedIn using OpenID Connect** and **Share on LinkedIn**.
3. Add `http://127.0.0.1:3000/oauth/callback` as an authorized redirect URL.
4. Copy the client ID and client secret into a local `.env` file.

## Run locally

```bash
npm install
cp .env.example .env
npm run build
npm start
```

The server uses stdio, which is the simplest transport for Copilot CLI. Add it to your MCP configuration with the command and environment variables from `.env`.

Call `linkedin_authenticate`, open the returned URL, approve access, and then call `linkedin_auth_status`.

Example MCP configuration:

```json
{
  "mcpServers": {
    "linkedin": {
      "command": "node",
      "args": ["/absolute/path/to/linkedin-mcp-server/dist/server.js"],
      "env": {
        "LINKEDIN_CLIENT_ID": "your-client-id",
        "LINKEDIN_CLIENT_SECRET": "your-client-secret"
      }
    }
  }
}
```

## Security

- Never commit `.env` or `.data/`.
- The local token file is created with owner-only permissions.
- Publishing requires an explicit `confirm=true` argument.
- LinkedIn client secrets and tokens must stay server-side.
- Never paste real credentials or token files into issues, pull requests, or
  public repositories.

## License

MIT. See [LICENSE](LICENSE).

## Azure deployment plan

Azure is not required for the local version. Deploy only if the server must be available to multiple clients or run continuously.

The production design should use:

- Azure Container Apps or Azure App Service for the MCP HTTP service.
- Azure Key Vault for the LinkedIn client secret and encryption key.
- Encrypted durable storage for refresh/access tokens.
- A registered HTTPS redirect URL.
- Authentication and audit logging before exposing the service outside the local machine.

The local stdio transport should remain the default for personal Copilot use; an Azure deployment is a separate production transport and security boundary.

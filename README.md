# LinkedIn MCP Server

A local-first [Model Context Protocol (MCP)](https://modelcontextprotocol.io/)
server for LinkedIn's official OAuth and REST APIs. Each user runs their own
instance and supplies credentials from their own LinkedIn Developer app.

## Capabilities

The server exposes these MCP tools:

| Tool | Capability |
| --- | --- |
| `linkedin_authenticate` | Starts the local LinkedIn OAuth flow. |
| `linkedin_auth_status` | Checks whether a local LinkedIn access token is available. |
| `linkedin_get_my_profile` | Reads the authenticated member's OpenID profile and email. |
| `linkedin_create_post` | Publishes a text post to the authenticated member's LinkedIn profile. Publishing requires `confirm=true`. |
| `linkedin_create_post_with_image` | Uploads a local image and publishes it with a text post. Publishing requires `confirm=true`. |
| `linkedin_reshare_post` | Reshares an existing post with optional commentary. Requires `confirm=true`. |
| `linkedin_create_comment` | Creates a comment on a post. Requires `confirm=true`. |
| `linkedin_react_to_post` | Adds a reaction such as Like, Praise, Empathy, Interest, Appreciation, or Entertainment. Requires `confirm=true`. |
| `linkedin_remove_reaction` | Removes your reaction from a post. Requires `confirm=true`. |
| `linkedin_edit_comment` | Edits one of your comments. Requires `confirm=true`. |
| `linkedin_delete_comment` | Deletes one of your comments. Requires `confirm=true`. |
| `linkedin_delete_post` | Deletes one of your posts. Requires `confirm=true`. |

The server uses LinkedIn's official APIs only. It does not scrape LinkedIn,
use browser cookies, search arbitrary people, read messages, or export
connections.

## LinkedIn Developer App Setup

LinkedIn API access is controlled by LinkedIn. A copy of this project does not
provide API access or bypass LinkedIn permissions; every user must create and
configure their own Developer app.

### 1. Create or select an app and Company Page

Create an app in the [LinkedIn Developer Portal](https://www.linkedin.com/developers/apps)
and associate it with a LinkedIn Company Page. A personal developer can create
a small development Company Page and associate the app with it.

The default individual-developer page may be enough for basic sign-in, but it
can restrict additional API products. If you need to publish posts, use a
Company Page that permits the required product access.

### 2. Add products

Scopes are enabled through products rather than by adding scopes individually:

1. Open the app's **Products** tab.
2. Request **Sign In with LinkedIn using OpenID Connect**.
3. Request **Share on LinkedIn**.
4. Confirm both products appear under **Added products**.

These products enable the scopes used by this server:

- **Sign In with LinkedIn using OpenID Connect** enables `openid`, `profile`,
  and `email`.
- **Share on LinkedIn** enables `w_member_social`, required for posting.

Product approval and availability are controlled by LinkedIn. If
**Share on LinkedIn** is not approved, authentication with this server's
default scope set will fail and posting will not work.

### 3. Register the redirect URL

In the app's **Auth** tab, add this exact Authorized redirect URL:

```text
http://127.0.0.1:3000/oauth/callback
```

The scheme, host, port, and path must match exactly. `localhost` and
`127.0.0.1` are different redirect URLs. If you use another local callback,
set `LINKEDIN_REDIRECT_URI` to that value and register the exact same value in
LinkedIn. The server permits only local `localhost` or `127.0.0.1` callbacks.

### 4. Copy credentials

From the app's **Auth** tab, copy the Client ID and Client Secret. Keep the
Client Secret private.

## Run locally

```bash
npm install
cp .env.example .env
# Edit .env and add the Client ID and Client Secret.
npm run build
npm start
```

The server uses stdio, which is the simplest transport for Copilot CLI and
other MCP clients. It should normally be launched by the MCP client rather
than opened as an interactive terminal application.

## Configuration

Required variables:

```text
LINKEDIN_CLIENT_ID=your-linkedin-client-id
LINKEDIN_CLIENT_SECRET=your-linkedin-client-secret
```

Optional variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `LINKEDIN_REDIRECT_URI` | `http://127.0.0.1:3000/oauth/callback` | Local OAuth callback; register the exact value in LinkedIn. |
| `LINKEDIN_VERSION` | `202607` | LinkedIn REST API version for `/rest/*` requests. |
| `LINKEDIN_TOKEN_FILE` | `.data/linkedin-token.json` | Local access-token file location. |

## MCP client configuration

Use an absolute path to the cloned repository:

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

Prefer the MCP client's secret or environment-variable facility instead of
committing credentials to a configuration file.

## Authenticate and use

1. Start the MCP server through your MCP client.
2. Call `linkedin_authenticate`.
3. Open the returned LinkedIn authorization URL.
4. Approve access.
5. Call `linkedin_auth_status`.
6. Call any of the tools above. Mutating tools require `confirm=true`.

Mutating tools require explicit confirmation to reduce accidental publishing or
deletion. Example arguments:

```json
{
  "commentary": "Hello from my LinkedIn MCP server.",
  "confirm": true
}
```

For social actions, provide the LinkedIn post URN returned by LinkedIn or a
previous API response:

```json
{
  "postUrn": "urn:li:share:123456789",
  "commentary": "Thanks for sharing this.",
  "confirm": true
}
```

The comment, reaction, reshare, edit, and delete tools operate on the specific
post or comment identified by their URN/ID. They do not search LinkedIn or read
your feed. The current default OAuth scopes support identity and member social
actions, but do not provide general post-history, comment-history, messaging,
people-search, or connections-read access.

LinkedIn controls access to individual API products and may change endpoint
requirements. If a social-action call returns an authorization or scope error,
check the app's enabled products and the permissions currently granted to the
token; some newer feed APIs may require a feed-specific permission that is not
included in the default `w_member_social` scope.

## Troubleshooting

### `redirect_uri does not match the registered value`

Register the exact callback URL shown above, or make sure
`LINKEDIN_REDIRECT_URI` exactly matches the URL registered in LinkedIn. Check
the hostname (`127.0.0.1` versus `localhost`) and port.

### `invalid_scope_error`

Verify that both required products are listed under **Added products**. If
**Share on LinkedIn** is missing or not approved, `w_member_social` is
unavailable and posting cannot succeed.

### Re-authentication

Delete the local token file only when you intentionally want to authenticate
again:

```bash
rm .data/linkedin-token.json
```

Then call `linkedin_authenticate`.

## Security

- Never commit `.env` or `.data/`.
- The local token file is created with owner-only permissions.
- Publishing requires explicit `confirm=true`.
- Keep LinkedIn client secrets and tokens server-side.
- Never paste credentials or token files into issues, pull requests, or public
  repositories.

## Azure deployment plan

Azure is not required for the local version. Deploy only if the server must be
available to multiple clients or run continuously.

A production deployment should use Azure Container Apps or App Service for the
MCP HTTP service, Azure Key Vault for secrets and encryption keys, encrypted
durable storage for tokens, a registered HTTPS redirect URL, and authentication
and audit logging before exposing the service outside the local machine.

The local stdio transport should remain the default for personal Copilot use;
an Azure deployment is a separate production transport and security boundary.

## License

MIT. See [LICENSE](LICENSE).

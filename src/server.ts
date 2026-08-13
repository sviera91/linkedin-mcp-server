import { createServer, type Server } from "node:http";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile, chmod } from "node:fs/promises";
import { dirname, extname } from "node:path";
import { URL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const clientId = requiredEnv("LINKEDIN_CLIENT_ID");
const clientSecret = requiredEnv("LINKEDIN_CLIENT_SECRET");
const redirectUri = process.env.LINKEDIN_REDIRECT_URI ?? "http://127.0.0.1:3000/oauth/callback";
const linkedinVersion = process.env.LINKEDIN_VERSION ?? "202607";
const tokenFile = process.env.LINKEDIN_TOKEN_FILE ?? ".data/linkedin-token.json";
const scopes = ["openid", "profile", "email", "w_member_social"];

type Token = {
  access_token: string;
  expires_in: number;
  created_at: number;
  refresh_token?: string;
};

let oauthServer: Server | undefined;
let pendingState: string | undefined;

const server = new McpServer({
  name: "linkedin",
  version: "0.1.0"
});

server.tool(
  "linkedin_authenticate",
  "Start LinkedIn OAuth sign-in. Open the returned URL in a browser, approve access, then call linkedin_auth_status.",
  {},
  async () => {
    const callback = new URL(redirectUri);
    if (callback.hostname !== "127.0.0.1" && callback.hostname !== "localhost") {
      throw new Error("Local authentication requires LINKEDIN_REDIRECT_URI to use localhost or 127.0.0.1.");
    }

    pendingState = randomBytes(24).toString("hex");
    await startCallbackServer(callback);

    const authorizationUrl = new URL("https://www.linkedin.com/oauth/v2/authorization");
    authorizationUrl.search = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      state: pendingState,
      scope: scopes.join(" ")
    }).toString();

    return {
      content: [{
        type: "text",
        text: `Open this URL to authorize LinkedIn:\n${authorizationUrl}\n\nAfter approval, call linkedin_auth_status.`
      }]
    };
  }
);

server.tool(
  "linkedin_auth_status",
  "Check whether LinkedIn OAuth has completed and the local token is available.",
  {},
  async () => {
    const token = await readToken();
    return {
      content: [{
        type: "text",
        text: token
          ? "LinkedIn is connected. The local access token is available."
          : pendingState
            ? "Authorization is pending. Open the URL returned by linkedin_authenticate."
            : "LinkedIn is not connected. Call linkedin_authenticate first."
      }]
    };
  }
);

server.tool(
  "linkedin_get_my_profile",
  "Read the authenticated LinkedIn member's OpenID profile and email.",
  {},
  async () => {
    const response = await linkedinRequest("/v2/userinfo");
    return jsonResult(response);
  }
);

server.tool(
  "linkedin_create_post",
  "Publish a text post to the authenticated member's LinkedIn profile.",
  {
    commentary: z.string().min(1).max(3000).describe("The post text to publish."),
    confirm: z.boolean().describe("Must be true to publish the post.")
  },
  async ({ commentary, confirm }) => {
    if (!confirm) {
      throw new Error("Publishing requires confirm=true.");
    }

    const profile = await linkedinRequest("/v2/userinfo");
    const profileJson = await profile.json() as { sub?: string };
    if (!profileJson.sub) {
      throw new Error("LinkedIn did not return the authenticated member identifier.");
    }

    const response = await linkedinRequest("/rest/posts", {
      method: "POST",
      body: JSON.stringify({
        author: `urn:li:person:${profileJson.sub}`,
        commentary,
        visibility: "PUBLIC",
        distribution: {
          feedDistribution: "MAIN_FEED",
          targetEntities: [],
          thirdPartyDistributionChannels: []
        },
        lifecycleState: "PUBLISHED",
        isReshareDisabledByAuthor: false
      })
    });

    return jsonResult(response);
  }
);

server.tool(
  "linkedin_create_post_with_image",
  "Upload a local image and publish it with a text post to the authenticated member's LinkedIn profile.",
  {
    commentary: z.string().min(1).max(3000).describe("The post text to publish."),
    imagePath: z.string().min(1).describe("Absolute path to a local JPEG, PNG, GIF, or WebP image."),
    confirm: z.boolean().describe("Must be true to upload and publish the post.")
  },
  async ({ commentary, imagePath, confirm }) => {
    if (!confirm) {
      throw new Error("Publishing requires confirm=true.");
    }

    const profile = await linkedinRequest("/v2/userinfo");
    const profileJson = await profile.json() as { sub?: string };
    if (!profileJson.sub) {
      throw new Error("LinkedIn did not return the authenticated member identifier.");
    }

    const image = await readFile(imagePath);
    const contentType = imageContentType(imagePath);
    const initializeResponse = await linkedinRequest("/rest/images?action=initializeUpload", {
      method: "POST",
      body: JSON.stringify({
        initializeUploadRequest: {
          owner: `urn:li:person:${profileJson.sub}`
        }
      })
    });
    const initializeJson = await initializeResponse.json() as {
      value?: { uploadUrl?: string; image?: string };
    };
    const uploadUrl = initializeJson.value?.uploadUrl;
    const imageUrn = initializeJson.value?.image;
    if (!uploadUrl || !imageUrn) {
      throw new Error("LinkedIn did not return an image upload URL and image URN.");
    }

    const uploadResponse = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": contentType },
      body: image
    });
    if (!uploadResponse.ok) {
      throw new Error(`LinkedIn image upload failed (${uploadResponse.status}).`);
    }

    const postResponse = await linkedinRequest("/rest/posts", {
      method: "POST",
      body: JSON.stringify({
        author: `urn:li:person:${profileJson.sub}`,
        commentary,
        visibility: "PUBLIC",
        distribution: {
          feedDistribution: "MAIN_FEED",
          targetEntities: [],
          thirdPartyDistributionChannels: []
        },
        content: { media: { id: imageUrn } },
        lifecycleState: "PUBLISHED",
        isReshareDisabledByAuthor: false
      })
    });

    return jsonResult(postResponse);
  }
);

server.tool(
  "linkedin_reshare_post",
  "Reshare an existing LinkedIn post with optional commentary.",
  {
    postUrn: z.string().min(1).describe("The post URN, such as urn:li:share:123."),
    commentary: z.string().max(3000).default("").describe("Optional commentary."),
    confirm: z.boolean().describe("Must be true to publish the reshare.")
  },
  async ({ postUrn, commentary, confirm }) => {
    requireConfirmation(confirm);
    const author = await getMemberUrn();
    return jsonResult(await createPost({
      author,
      commentary,
      visibility: "PUBLIC",
      distribution: {
        feedDistribution: "MAIN_FEED",
        targetEntities: [],
        thirdPartyDistributionChannels: []
      },
      lifecycleState: "PUBLISHED",
      isReshareDisabledByAuthor: false,
      reshareContext: { parent: postUrn }
    }));
  }
);

server.tool(
  "linkedin_create_comment",
  "Create a comment on a LinkedIn post.",
  {
    postUrn: z.string().min(1).describe("The post URN to comment on."),
    commentary: z.string().min(1).max(1250).describe("The comment text."),
    confirm: z.boolean().describe("Must be true to publish the comment.")
  },
  async ({ postUrn, commentary, confirm }) => {
    requireConfirmation(confirm);
    const response = await linkedinRequest(
      `/rest/socialActions/${encodeURIComponent(postUrn)}/comments`,
      {
        method: "POST",
        body: JSON.stringify({
          actor: await getMemberUrn(),
          object: postUrn,
          message: { text: commentary }
        })
      }
    );
    return jsonResult(response);
  }
);

server.tool(
  "linkedin_react_to_post",
  "Add a reaction to a LinkedIn post.",
  {
    postUrn: z.string().min(1).describe("The post URN to react to."),
    reactionType: z.enum(["LIKE", "PRAISE", "EMPATHY", "INTEREST", "APPRECIATION", "ENTERTAINMENT"])
      .default("LIKE"),
    confirm: z.boolean().describe("Must be true to add the reaction.")
  },
  async ({ postUrn, reactionType, confirm }) => {
    requireConfirmation(confirm);
    const response = await linkedinRequest(
      `/rest/reactions?actor=${encodeURIComponent(await getMemberUrn())}`,
      {
        method: "POST",
        body: JSON.stringify({ root: postUrn, reactionType })
      }
    );
    return jsonResult(response);
  }
);

server.tool(
  "linkedin_remove_reaction",
  "Remove your reaction from a LinkedIn post.",
  {
    postUrn: z.string().min(1).describe("The post URN."),
    confirm: z.boolean().describe("Must be true to remove the reaction.")
  },
  async ({ postUrn, confirm }) => {
    requireConfirmation(confirm);
    const reactionUrn = `urn:li:reaction:(${await getMemberUrn()},${postUrn})`;
    const response = await linkedinRequest(`/rest/reactions/${encodeURIComponent(reactionUrn)}`, {
      method: "DELETE"
    });
    return jsonResult(response);
  }
);

server.tool(
  "linkedin_delete_post",
  "Delete one of your LinkedIn posts.",
  {
    postUrn: z.string().min(1).describe("The URN of your post."),
    confirm: z.boolean().describe("Must be true to permanently delete the post.")
  },
  async ({ postUrn, confirm }) => {
    requireConfirmation(confirm);
    const response = await linkedinRequest(`/rest/posts/${encodeURIComponent(postUrn)}`, {
      method: "DELETE"
    });
    return jsonResult(response);
  }
);

server.tool(
  "linkedin_edit_comment",
  "Edit one of your comments on a LinkedIn post.",
  {
    postUrn: z.string().min(1).describe("The post URN containing the comment."),
    commentId: z.string().min(1).describe("The LinkedIn comment ID."),
    commentary: z.string().min(1).max(1250).describe("The replacement comment text."),
    confirm: z.boolean().describe("Must be true to modify the comment.")
  },
  async ({ postUrn, commentId, commentary, confirm }) => {
    requireConfirmation(confirm);
    const response = await linkedinRequest(
      `/rest/socialActions/${encodeURIComponent(postUrn)}/comments/${encodeURIComponent(commentId)}`,
      {
        method: "POST",
        headers: { "X-RestLi-Method": "PARTIAL_UPDATE" },
        body: JSON.stringify({ patch: { message: { $set: { text: commentary } } } })
      }
    );
    return jsonResult(response);
  }
);

server.tool(
  "linkedin_delete_comment",
  "Delete one of your comments from a LinkedIn post.",
  {
    postUrn: z.string().min(1).describe("The post URN containing the comment."),
    commentId: z.string().min(1).describe("The LinkedIn comment ID."),
    confirm: z.boolean().describe("Must be true to permanently delete the comment.")
  },
  async ({ postUrn, commentId, confirm }) => {
    requireConfirmation(confirm);
    const response = await linkedinRequest(
      `/rest/socialActions/${encodeURIComponent(postUrn)}/comments/${encodeURIComponent(commentId)}`,
      { method: "DELETE" }
    );
    return jsonResult(response);
  }
);

async function startCallbackServer(callback: URL): Promise<void> {
  if (oauthServer) {
    return;
  }

  oauthServer = createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? "/", redirectUri);
      if (requestUrl.pathname !== callback.pathname) {
        response.writeHead(404).end("Not found");
        return;
      }

      const returnedState = requestUrl.searchParams.get("state");
      const code = requestUrl.searchParams.get("code");
      const error = requestUrl.searchParams.get("error");
      if (error) {
        response.writeHead(400).end(`LinkedIn authorization failed: ${error}`);
        return;
      }
      if (!code || !pendingState || returnedState !== pendingState) {
        response.writeHead(400).end("Invalid OAuth callback.");
        return;
      }

      const tokenResponse = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
          client_id: clientId,
          client_secret: clientSecret
        })
      });
      if (!tokenResponse.ok) {
        throw new Error(`LinkedIn token exchange failed (${tokenResponse.status}).`);
      }

      const token = await tokenResponse.json() as Omit<Token, "created_at">;
      await saveToken({ ...token, created_at: Date.now() });
      pendingState = undefined;
      response.writeHead(200, { "Content-Type": "text/html" })
        .end("<h1>LinkedIn connected</h1><p>You can close this window and return to Copilot.</p>");
    } catch (error) {
      response.writeHead(500).end(error instanceof Error ? error.message : "OAuth callback failed.");
    }
  });

  await new Promise<void>((resolve, reject) => {
    oauthServer?.once("listening", () => resolve());
    oauthServer?.once("error", reject);
    oauthServer?.listen(Number(callback.port || 80), callback.hostname);
  });
}

async function getMemberUrn(): Promise<string> {
  const profile = await linkedinRequest("/v2/userinfo");
  const profileJson = await profile.json() as { sub?: string };
  if (!profileJson.sub) {
    throw new Error("LinkedIn did not return the authenticated member identifier.");
  }
  return `urn:li:person:${profileJson.sub}`;
}

async function createPost(body: Record<string, unknown>): Promise<Response> {
  return linkedinRequest("/rest/posts", {
    method: "POST",
    body: JSON.stringify(body)
  });
}

function requireConfirmation(confirm: boolean): void {
  if (!confirm) {
    throw new Error("This LinkedIn action requires confirm=true.");
  }
}

async function linkedinRequest(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await readToken();
  if (!token) {
    throw new Error("LinkedIn is not connected. Call linkedin_authenticate first.");
  }
  if (Date.now() >= token.created_at + token.expires_in * 1000) {
    throw new Error("The LinkedIn access token has expired. Re-authenticate with linkedin_authenticate.");
  }

  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token.access_token}`);
  headers.set("X-Restli-Protocol-Version", "2.0.0");
  if (path.startsWith("/rest/")) {
    headers.set("Linkedin-Version", linkedinVersion);
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`https://api.linkedin.com${path}`, { ...init, headers });
  if (!response.ok) {
    const details = await response.text();
    throw new Error(`LinkedIn API request failed (${response.status}): ${details}`);
  }
  return response;
}

async function readToken(): Promise<Token | undefined> {
  try {
    return JSON.parse(await readFile(tokenFile, "utf8")) as Token;
  } catch (error) {
    if (isNotFound(error)) {
      return undefined;
    }
    throw error;
  }
}

async function saveToken(token: Token): Promise<void> {
  await mkdir(dirname(tokenFile), { recursive: true });
  await writeFile(tokenFile, JSON.stringify(token, null, 2), { mode: 0o600 });
  await chmod(tokenFile, 0o600);
}

function jsonResult(response: Response): Promise<{ content: [{ type: "text"; text: string }] }> {
  return response.json().then((value) => ({
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }]
  }));
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function imageContentType(imagePath: string): string {
  const contentTypes: Record<string, string> = {
    ".gif": "image/gif",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp"
  };
  const contentType = contentTypes[extname(imagePath).toLowerCase()];
  if (!contentType) {
    throw new Error("Unsupported image type. Use JPEG, PNG, GIF, or WebP.");
  }
  return contentType;
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

await server.connect(new StdioServerTransport());

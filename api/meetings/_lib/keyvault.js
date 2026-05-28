// api/meetings/_lib/keyvault.js
import { ClientSecretCredential } from "@azure/identity";
import { SecretClient } from "@azure/keyvault-secrets";

let client = null;
const cache = new Map();

function getClient() {
  if (!client) {
    const url = process.env.AZURE_KV_URL;
    const tenantId = process.env.AZURE_KV_TENANT_ID;
    const clientId = process.env.AZURE_KV_CLIENT_ID;
    const clientSecret = process.env.AZURE_KV_CLIENT_SECRET;
    if (!url || !tenantId || !clientId || !clientSecret) {
      throw new Error("Missing AZURE_KV_* environment variables");
    }
    const credential = new ClientSecretCredential(tenantId, clientId, clientSecret);
    client = new SecretClient(url, credential);
  }
  return client;
}

export async function getSecret(name) {
  if (cache.has(name)) return cache.get(name);
  const secret = await getClient().getSecret(name);
  cache.set(name, secret.value);
  return secret.value;
}

export async function getGoogleCredentials() {
  const raw = await getSecret("google-service-account-key");
  return JSON.parse(raw);
}

export async function getTeamsCredentials() {
  const [clientId, clientSecret, tenantId, hostUserId] = await Promise.all([
    getSecret("teams-client-id"),
    getSecret("teams-client-secret"),
    getSecret("teams-tenant-id"),
    getSecret("teams-host-user-id"),
  ]);
  return { clientId, clientSecret, tenantId, hostUserId };
}

export async function getPostmarkToken() {
  return getSecret("postmark-server-token");
}

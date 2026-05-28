// api/meetings/_lib/graph-mail.js
// Microsoft Graph Mail API — sends email from meetings@vistamarconsulting.com

import { getTeamsCredentials } from "./keyvault.js";

// ── Auth ──

let cachedToken = null;
let tokenExpiry = 0;

async function getToken() {
  if (cachedToken && Date.now() < tokenExpiry - 60000) return cachedToken;
  const { clientId, clientSecret, tenantId } = await getTeamsCredentials();
  const res = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        scope: "https://graph.microsoft.com/.default",
        grant_type: "client_credentials",
      }),
    }
  );
  if (!res.ok) throw new Error(`Graph auth failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  cachedToken = data.access_token;
  tokenExpiry = Date.now() + data.expires_in * 1000;
  return cachedToken;
}

// ── Send Mail ──

export async function sendMail({ to, subject, htmlBody }) {
  const token = await getToken();
  const { hostUserId } = await getTeamsCredentials();
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users/${hostUserId}/sendMail`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: {
          subject,
          body: { contentType: "HTML", content: htmlBody },
          toRecipients: [{ emailAddress: { address: to } }],
        },
      }),
    }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`sendMail failed (${res.status}): ${text}`);
  }
  // Graph sendMail returns 202 Accepted with no body on success
}

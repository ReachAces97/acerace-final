export async function onRequest(context) {
  const clientId = context.env.KICK_CLIENT_ID;
  const redirectUri = context.env.KICK_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    return new Response("Missing KICK_CLIENT_ID or KICK_REDIRECT_URI in Cloudflare variables", { status: 500 });
  }

  // Generate PKCE verifier and challenge (required by Kick)
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  const codeVerifier = btoa(String.fromCharCode(...array))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

  const encoder = new TextEncoder();
  const data = encoder.encode(codeVerifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const codeChallenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

  // Put the verifier inside the state so callback.js can read it
  const statePayload = JSON.stringify({ v: codeVerifier });
  const state = btoa(statePayload).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

  // 🔴 THIS IS THE KEY FIX: Using id.kick.com instead of kick.com
  const kickAuthUrl = `https://id.kick.com/oauth/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=user:read&state=${state}&code_challenge=${codeChallenge}&code_challenge_method=S256`;

  return Response.redirect(kickAuthUrl, 302);
}
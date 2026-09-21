import crypto from 'crypto';

function base64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export async function onRequest(context) {
  const clientId = context.env.KICK_CLIENT_ID;
  if (!clientId) return new Response('Missing KICK_CLIENT_ID env', { status: 500 });

  // Generate PKCE verifier & challenge
  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());

  // Generate a random state and pack the verifier inside it (base64url encoded JSON)
  const plainState = { s: crypto.randomBytes(12).toString('hex'), v: verifier };
  const encodedState = base64url(JSON.stringify(plainState));

  // Build redirect URI from request origin if available
  const reqUrl = new URL(context.request.url);
  const origin = context.env.SITE_ORIGIN || reqUrl.origin;
  const redirectUri = origin + '/auth/kick/callback';

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: 'user:read',
    state: encodedState,
    code_challenge: challenge,
    code_challenge_method: 'S256'
  });

  const kickAuthUrl = `https://id.kick.com/oauth/authorize?${params.toString()}`;
  return Response.redirect(kickAuthUrl, 302);
}

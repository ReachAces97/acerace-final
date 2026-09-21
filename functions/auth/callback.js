import { Buffer } from 'node:buffer';

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');
  const error_description = url.searchParams.get('error_description');

  if (error) {
    return new Response(`<h3>Login failed</h3><p>${error_description || error}</p><button onclick="window.close()">Close</button>`, { headers: { 'Content-Type': 'text/html' } });
  }
  
  if (!code || !state) {
    return new Response('<h3>Missing code/state</h3><button onclick="window.close()">Close</button>', { headers: { 'Content-Type': 'text/html' } });
  }

  // Decode state (base64url JSON) to extract verifier
  function base64urlDecode(s) { 
    return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'); 
  }
  
  let verifier = null;
  try {
    const decoded = base64urlDecode(state);
    const parsed = JSON.parse(decoded);
    verifier = parsed.v;
  } catch (e) { /* ignore */ }

  const KICK_CLIENT_ID = context.env.KICK_CLIENT_ID;
  const KICK_CLIENT_SECRET = context.env.KICK_CLIENT_SECRET;
  const reqUrl = new URL(context.request.url);
  const origin = context.env.SITE_ORIGIN || reqUrl.origin;
  const redirectUri = origin + '/auth/kick/callback';

  if (!KICK_CLIENT_ID || !KICK_CLIENT_SECRET) {
    return new Response('<h3>Server misconfigured</h3><p>Environment variables missing.</p>', { headers: { 'Content-Type': 'text/html' }, status: 500 });
  }

  // Exchange code for token
  try {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: redirectUri,
      client_id: KICK_CLIENT_ID,
      client_secret: KICK_CLIENT_SECRET,
      code_verifier: verifier || ''
    });

    const tokenRes = await fetch('https://id.kick.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString()
    });

    if (!tokenRes.ok) throw new Error('Token exchange failed');
    const tokenData = await tokenRes.json();

    // Return an HTML page that posts message back to opener and closes itself
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Login Successful</title></head><body style="background:#0a0c12;color:#e2e8f0;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;"><div style="text-align:center;background:rgba(15,23,42,0.9);padding:24px;border-radius:16px;border:1px solid #19C6FD;"><h1>✅ Login Successful</h1><p>Returning to application...</p></div><script>if (window.opener) { window.opener.postMessage({ type: 'KICK_TOKEN', token: '${tokenData.access_token}', channel: null }, '*'); } setTimeout(() => window.close(), 1000);</script></body></html>`;
    
    return new Response(html, { headers: { 'Content-Type': 'text/html' } });
  } catch (e) {
    return new Response('<h3>Login failed during token exchange</h3>', { headers: { 'Content-Type': 'text/html' }, status: 500 });
  }
}
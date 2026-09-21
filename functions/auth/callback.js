export async function onRequest(context) {
  const url = new URL(context.request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');
  const error_description = url.searchParams.get('error_description');

  // 1. Handle errors sent back by Kick
  if (error) {
    return new Response(`<h3>Login failed</h3><p>${error_description || error}</p><button onclick="window.close()">Close</button>`, { headers: { 'Content-Type': 'text/html' } });
  }
  
  if (!code || !state) {
    return new Response('<h3>Missing code/state</h3><button onclick="window.close()">Close</button>', { headers: { 'Content-Type': 'text/html' } });
  }

  // 2. Decode the state to get the PKCE verifier (using standard web APIs)
  function base64urlDecode(s) { 
    return atob(s.replace(/-/g, '+').replace(/_/g, '/')); 
  }
  
  let verifier = null;
  try {
    const decoded = base64urlDecode(state);
    const parsed = JSON.parse(decoded);
    verifier = parsed.v;
  } catch (e) { 
    console.error("Failed to decode state:", e);
  }

  const KICK_CLIENT_ID = context.env.KICK_CLIENT_ID;
  const KICK_CLIENT_SECRET = context.env.KICK_CLIENT_SECRET;
  
  // Use the exact redirect URI from environment variables
  const redirectUri = context.env.KICK_REDIRECT_URI || url.origin + '/auth/kick/callback';

  if (!KICK_CLIENT_ID || !KICK_CLIENT_SECRET) {
    return new Response('<h3>Server misconfigured</h3><p>Environment variables missing.</p>', { headers: { 'Content-Type': 'text/html' }, status: 500 });
  }

  // 3. Exchange the code for an access token
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

    // Catch specific Kick errors
    if (!tokenRes.ok) {
      const errorText = await tokenRes.text();
      console.error('Kick Token Exchange Error:', errorText);
      throw new Error(errorText);
    }
    
    const tokenData = await tokenRes.json();

    // 4. Success! Redirect back to the main page with the token in the URL hash
    // This completely bypasses popup blockers and window.opener issues.
    const redirectUrl = `${url.origin}/#token=${tokenData.access_token}`;
    return Response.redirect(redirectUrl, 302);

  } catch (e) {
    return new Response(`<h3>Login failed during token exchange</h3><p style="color:red; font-size:14px;">${e.message}</p><button onclick="window.close()">Close</button>`, { headers: { 'Content-Type': 'text/html' }, status: 500 });
  }
}
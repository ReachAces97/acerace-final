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

    // 4. Return HTML that sends the token back to the main window with Debug Logs
    const html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Login Successful</title>
</head>
<body style="background:#0a0c12;color:#e2e8f0;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;font-family:sans-serif;">
    <div style="text-align:center;background:rgba(15,23,42,0.9);padding:24px;border-radius:16px;border:1px solid #19C6FD;">
        <h1>✅ Login Successful</h1>
        <p id="status">Returning to application...</p>
    </div>
    <script>
        console.log("Popup loaded. Checking for opener...");
        
        if (window.opener) { 
            console.log("Opener found! Sending token to main window...");
            window.opener.postMessage({ 
                type: 'KICK_TOKEN', 
                token: '${tokenData.access_token}', 
                channel: null 
            }, '*'); 
            document.getElementById('status').innerText = "Token sent! Closing...";
        } else {
            console.log("Error: window.opener is null!");
            document.getElementById('status').innerText = "Error: window.opener is null. This popup was opened incorrectly.";
            document.getElementById('status').style.color = "red";
        }
        
        // Give it 3 seconds so you can read the debug messages before it closes
        setTimeout(() => window.close(), 3000);
    </script>
</body>
</html>`;
    
    return new Response(html, { headers: { 'Content-Type': 'text/html' } });

  } catch (e) {
    return new Response(`<h3>Login failed during token exchange</h3><p style="color:red; font-size:14px;">${e.message}</p><button onclick="window.close()">Close</button>`, { headers: { 'Content-Type': 'text/html' }, status: 500 });
  }
}
export async function onRequest(context) {
  const clientId = context.env.KICK_CLIENT_ID; 
  
  // Pulls the correct permanent URL directly from your Cloudflare variables
  const redirectUri = context.env.KICK_REDIRECT_URI || "https://acerace-final50.pages.dev/auth/kick/callback";
  
  if (!clientId) {
    return new Response("Missing KICK_CLIENT_ID in Cloudflare variables", { status: 500 });
  }

  const kickAuthUrl = `https://kick.com/oauth/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=user:read`;

  return Response.redirect(kickAuthUrl, 302);
}
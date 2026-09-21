export async function onRequest(context) {
  const clientId = context.env.KICK_CLIENT_ID;
  const origin = context.env.SITE_ORIGIN || 'https://your-pages-domain.pages.dev';
  const redirectUri = origin + '/auth/kick/callback';
  const kickAuthUrl = `https://kick.com/oauth/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=user:read`;
  return Response.redirect(kickAuthUrl, 302);
}

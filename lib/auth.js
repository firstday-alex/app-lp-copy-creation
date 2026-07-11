// Optional shared-access gate. If APP_ACCESS_TOKEN is set in the environment,
// every /api call must send a matching `x-app-token` header. Leave it unset to
// keep the app open (and rely on Vercel deployment protection instead).
export function checkAccess(req, res){
  const required = process.env.APP_ACCESS_TOKEN;
  if (!required) return true;                       // gate disabled
  const got = req.headers['x-app-token'];
  if (got && got === required) return true;
  res.status(401).json({ error: 'Unauthorized — missing or wrong access token. Set it in Settings.' });
  return false;
}

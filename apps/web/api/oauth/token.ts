import { assertSameOrigin, errorResponse, exchangeCode, json, readJsonBody, validateExchangeInput } from '../_lib/broker.js';

/**
 * POST /api/oauth/token
 * Body: { platform, code, redirectUri, codeVerifier? }
 * Returns: { accessToken, refreshToken?, expiresIn?, scope? }
 */
export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'METHOD_NOT_ALLOWED' });
  try {
    assertSameOrigin(req);
    const input = validateExchangeInput(await readJsonBody(req));
    const tokens = await exchangeCode(input, process.env);
    return json(200, tokens);
  } catch (err) {
    return errorResponse(err);
  }
}

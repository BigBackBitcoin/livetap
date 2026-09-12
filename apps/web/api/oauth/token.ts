import {
  assertSameOrigin,
  assertWithinRateLimit,
  errorResponse,
  exchangeCode,
  json,
  readJsonBody,
  requestHost,
  validateExchangeInput,
} from '../_lib/broker.js';
import { nodeHandler } from '../_lib/node.js';

/**
 * POST /api/oauth/token
 * Body: { platform, code, redirectUri, codeVerifier? }
 * Returns: { accessToken, refreshToken?, expiresIn?, scope? }
 *
 * Order matters: cross-origin first (cheapest, and a rejected origin should not
 * consume the caller's rate-limit budget), then the limiter, then the body.
 * The `host` header is passed to the validator so `redirectUri` is pinned to
 * this deployment's own origin (plus loopback and `livetap://` for the apps).
 */
export async function handle(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'METHOD_NOT_ALLOWED' });
  try {
    assertSameOrigin(req);
    assertWithinRateLimit(req);
    const input = validateExchangeInput(await readJsonBody(req), requestHost(req));
    const tokens = await exchangeCode(input, process.env);
    return json(200, tokens);
  } catch (err) {
    return errorResponse(err);
  }
}

export default nodeHandler(handle);

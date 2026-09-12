import {
  assertSameOrigin,
  assertWithinRateLimit,
  errorResponse,
  json,
  readJsonBody,
  refreshToken,
  validateRefreshInput,
} from '../_lib/broker.js';
import { nodeHandler } from '../_lib/node.js';

/**
 * POST /api/oauth/refresh
 * Body: { platform, refreshToken }
 * Returns: { accessToken, refreshToken?, expiresIn?, scope? }
 */
export async function handle(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'METHOD_NOT_ALLOWED' });
  try {
    assertSameOrigin(req);
    assertWithinRateLimit(req);
    const input = validateRefreshInput(await readJsonBody(req));
    const tokens = await refreshToken(input, process.env);
    return json(200, tokens);
  } catch (err) {
    return errorResponse(err);
  }
}

export default nodeHandler(handle);

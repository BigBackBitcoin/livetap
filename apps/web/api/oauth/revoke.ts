import {
  assertSameOrigin,
  assertWithinRateLimit,
  errorResponse,
  json,
  readJsonBody,
  revoke,
  validateRevokeInput,
} from '../_lib/broker.js';
import { nodeHandler } from '../_lib/node.js';

/**
 * POST /api/oauth/revoke
 * Body: { platform, token }
 * Returns: { revoked: boolean }
 *
 * The server half of Disconnect. Deleting the token from the device's vault stops LIVETAP using
 * it; only this makes the platform forget LIVETAP, which is what a creator means when they tap
 * a button labelled Disconnect.
 *
 * It needs the client secret for Google's revocation endpoint, which is why it lives here rather
 * than in the app, and it is deliberately forgiving: `revoke()` never rejects, so a creator whose
 * network is down still gets a clean answer and still gets their local copy deleted by the caller.
 */
export async function handle(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'METHOD_NOT_ALLOWED' });
  try {
    assertSameOrigin(req);
    assertWithinRateLimit(req);
    const input = validateRevokeInput(await readJsonBody(req));
    return json(200, await revoke(input, process.env));
  } catch (err) {
    return errorResponse(err);
  }
}

export default nodeHandler(handle);

import {
  assertSameOrigin,
  assertWithinRateLimit,
  BrokerError,
  errorResponse,
  isBrokerPlatform,
  json,
  pollDeviceCode,
  readJsonBody,
  startDeviceCode,
} from '../_lib/broker.js';
import { nodeHandler } from '../_lib/node.js';

/**
 * POST /api/oauth/device
 *
 * Two shapes, because a device flow is two steps and they share every input:
 *   { platform, scopes }              -> start:  { deviceCode, userCode, verificationUri, ... }
 *   { platform, scopes, deviceCode }  -> poll:   { pending: true } | a token set
 *
 * This exists for Twitch, which documents no PKCE anywhere. Without PKCE the only secretless way
 * a desktop build can sign a creator in is RFC 8628: LIVETAP shows a short code, the creator
 * types it on twitch.tv/activate, and LIVETAP polls until the grant appears. No redirect, no
 * loopback listener, and no client secret on the device.
 *
 * `pending` is a first-class, successful answer. Most polls in a healthy flow return it, and
 * turning the normal case into an HTTP error would make the client's job a guessing game.
 */
export async function handle(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'METHOD_NOT_ALLOWED' });
  try {
    assertSameOrigin(req);
    assertWithinRateLimit(req);
    const body = (await readJsonBody(req)) as Record<string, unknown> | null;
    if (!body || typeof body !== 'object') {
      throw new BrokerError(400, 'Body must be a JSON object.', 'BAD_REQUEST');
    }
    if (!isBrokerPlatform(body.platform)) throw new BrokerError(400, 'Unknown platform.', 'BAD_REQUEST');
    const scopes = Array.isArray(body.scopes)
      ? body.scopes.filter((s): s is string => typeof s === 'string' && s.length > 0 && s.length <= 128).slice(0, 32)
      : [];
    if (scopes.length === 0) throw new BrokerError(400, 'At least one scope is required.', 'BAD_REQUEST');

    if (body.deviceCode === undefined) {
      return json(200, await startDeviceCode(body.platform, scopes, process.env));
    }
    if (typeof body.deviceCode !== 'string' || body.deviceCode.length < 8 || body.deviceCode.length > 2048) {
      throw new BrokerError(400, 'Invalid deviceCode.', 'BAD_REQUEST');
    }
    const tokens = await pollDeviceCode(body.platform, body.deviceCode, scopes, process.env);
    return tokens ? json(200, tokens) : json(200, { pending: true });
  } catch (err) {
    return errorResponse(err);
  }
}

export default nodeHandler(handle);

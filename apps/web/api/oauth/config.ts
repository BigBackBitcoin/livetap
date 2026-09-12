import { configuredPlatforms, json } from '../_lib/broker.js';
import { nodeHandler } from '../_lib/node.js';

/**
 * GET /api/oauth/config
 * Tells the SPA which platforms have OAuth configured on this deployment (public client ids only).
 * The SPA uses this to show "Connect with account" vs "Paste a stream key".
 */
export async function handle(req: Request): Promise<Response> {
  if (req.method !== 'GET') return json(405, { error: 'METHOD_NOT_ALLOWED' });
  return json(200, { platforms: configuredPlatforms(process.env), mockMode: process.env.LIVETAP_MOCK_MODE !== 'false' });
}

export default nodeHandler(handle);

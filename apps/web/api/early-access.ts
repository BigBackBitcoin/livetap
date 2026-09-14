import {
  BrokerError,
  assertSameOrigin,
  assertWithinRateLimit,
  errorResponse,
  json,
  readJsonBody,
} from './_lib/broker.js';
import { nodeHandler } from './_lib/node.js';

/**
 * GET/POST /api/early-access
 *
 * There is no database, KV, Blob or mail provider configured on this Vercel project, and we will
 * not silently add one. So "get notified" is a thin, honest relay: when the deployment owner sets
 * `LIVETAP_EARLY_ACCESS_WEBHOOK` (an https URL they control -- a form backend, a mailing-list
 * endpoint, anything that accepts a JSON POST), this function forwards a signup to it. When the
 * env var is unset, the endpoint reports itself as disabled and stores nothing, so the SPA can
 * fall back to its GitHub "Watch releases" link. This function has no storage of its own: nothing
 * is written to disk, a table or a queue here, and the email is never logged.
 */

const EMAIL_MAX_LENGTH = 254;
/** RFC-ish: good enough to catch typos without rejecting a real address the platforms accept. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const PLATFORMS = ['mac', 'windows', 'ios', 'android', 'web'] as const;
type Platform = (typeof PLATFORMS)[number];

function isPlatform(value: unknown): value is Platform {
  return typeof value === 'string' && (PLATFORMS as readonly string[]).includes(value);
}

interface EarlyAccessInput {
  email: string;
  platform?: Platform;
}

function validateInput(body: unknown): EarlyAccessInput {
  if (!body || typeof body !== 'object') throw new BrokerError(400, 'Body must be a JSON object.', 'BAD_REQUEST');
  const b = body as Record<string, unknown>;
  if (
    typeof b.email !== 'string' ||
    b.email.length === 0 ||
    b.email.length > EMAIL_MAX_LENGTH ||
    !EMAIL_RE.test(b.email)
  ) {
    throw new BrokerError(400, 'A valid email is required.', 'BAD_REQUEST');
  }
  if (b.consent !== true) {
    throw new BrokerError(400, 'Consent is required.', 'BAD_REQUEST');
  }
  if (b.platform !== undefined && !isPlatform(b.platform)) {
    throw new BrokerError(400, 'Unknown platform.', 'BAD_REQUEST');
  }
  return { email: b.email, platform: b.platform as Platform | undefined };
}

/** The env var is a webhook target, not a public value -- callers must never see it. */
function webhookUrl(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const url = env.LIVETAP_EARLY_ACCESS_WEBHOOK;
  return url && /^https:\/\//i.test(url) ? url : undefined;
}

/** Per-IP budget for this endpoint. Reuses the broker's limiter with our own numbers. */
export const EARLY_ACCESS_RATE_LIMIT_MAX = 5;
export const EARLY_ACCESS_RATE_LIMIT_WINDOW_MS = 10 * 60_000;

const FORWARD_TIMEOUT_MS = 5_000;

async function forwardToWebhook(url: string, input: EarlyAccessInput, fetchFn: typeof fetch): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FORWARD_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        email: input.email,
        platform: input.platform,
        consentAt: new Date().toISOString(),
        source: 'livetap.vercel.app',
      }),
      signal: controller.signal,
    });
  } catch {
    throw new BrokerError(502, 'The notification endpoint could not be reached.', 'UPSTREAM');
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    throw new BrokerError(502, 'The notification endpoint refused the request.', 'UPSTREAM');
  }
}

/**
 * GET /api/early-access
 * Returns whether this deployment can take signups, never the endpoint itself.
 */
export async function handleGet(env: NodeJS.ProcessEnv = process.env): Promise<Response> {
  const enabled = Boolean(webhookUrl(env));
  return json(200, { enabled, method: enabled ? 'webhook' : 'none' });
}

/**
 * POST /api/early-access
 * Body: { email, consent: true, platform? }
 *
 * Order: same-origin first (cheapest, and a rejected origin should not consume the caller's
 * rate-limit budget), then the limiter, then whether this deployment is configured at all (so a
 * disabled deployment never touches the body or calls out), then validation, then the forward.
 */
export async function handlePost(
  req: Request,
  env: NodeJS.ProcessEnv = process.env,
  fetchFn: typeof fetch = fetch,
): Promise<Response> {
  try {
    assertSameOrigin(req);
    assertWithinRateLimit(req, Date.now(), EARLY_ACCESS_RATE_LIMIT_MAX, EARLY_ACCESS_RATE_LIMIT_WINDOW_MS);
    const url = webhookUrl(env);
    if (!url) return json(503, { ok: false, reason: 'NOT_CONFIGURED' });
    const input = validateInput(await readJsonBody(req));
    await forwardToWebhook(url, input, fetchFn);
    return json(202, { ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function handle(req: Request): Promise<Response> {
  try {
    if (req.method === 'GET') return await handleGet();
    if (req.method === 'POST') return await handlePost(req);
    return json(405, { error: 'METHOD_NOT_ALLOWED' });
  } catch (err) {
    return errorResponse(err);
  }
}

export default nodeHandler(handle);

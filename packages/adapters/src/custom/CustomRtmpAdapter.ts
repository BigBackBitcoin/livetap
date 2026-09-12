import {
  supportsFromProfile,
  validateIngest,
  type BroadcastHandle,
  type CapabilityKey,
  type CredentialRef,
  type DestinationAdapter,
  type DestinationConfig,
  type ErrorCode,
  type IngestTarget,
  type PlatformProfile,
} from '@livetap/core';
import { customProfile } from '../profiles/index.js';

/**
 * The real (non-mock) adapter for a user-supplied RTMP/RTMPS/SRT/WHIP endpoint.
 *
 * It makes no network calls at all: there is no control plane to talk to. Validation is
 * purely structural (core's `validateIngest`), "creating" a broadcast returns the ingest the
 * user configured, and stopping is a no-op because stopping means the sender stops sending.
 */
export class CustomRtmpAdapter implements DestinationAdapter {
  readonly profile: PlatformProfile;

  constructor(profile: PlatformProfile = customProfile) {
    this.profile = profile;
  }

  supports(capability: CapabilityKey): boolean {
    return supportsFromProfile(this.profile, capability);
  }

  async disconnect(_credential: CredentialRef | undefined): Promise<void> {
    // Nothing is stored for a custom destination beyond the config itself.
  }

  async validate(
    config: DestinationConfig,
    _credential?: CredentialRef,
  ): Promise<
    | { ok: true; credential?: CredentialRef; ingest?: IngestTarget; watchUrl?: string }
    | { ok: false; code: ErrorCode; technical?: string }
  > {
    const result = validateIngest(config.ingest);
    if (!result.ok) return { ok: false, code: 'CONFIG_INVALID', technical: result.errors.join(' ') };
    // Non-null: validateIngest only succeeds when an ingest object is present.
    return { ok: true, ingest: config.ingest as IngestTarget };
  }

  async createBroadcast(
    config: DestinationConfig,
    _credential?: CredentialRef,
  ): Promise<BroadcastHandle> {
    const result = validateIngest(config.ingest);
    if (!result.ok) {
      // Thrown so the orchestrator classifies it like any other creation failure.
      throw new CustomRtmpConfigError(result.errors.join(' '));
    }
    return { ingest: config.ingest as IngestTarget };
  }

  async stopBroadcast(_handle: BroadcastHandle, _credential?: CredentialRef): Promise<void> {
    // A custom destination ends when LIVETAP stops pushing bytes. There is nothing to call.
  }
}

export class CustomRtmpConfigError extends Error {
  readonly code = 'CONFIG_INVALID' as const;
  constructor(message: string) {
    super(message);
    this.name = 'CustomRtmpConfigError';
  }
}

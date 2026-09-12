/**
 * A demo ingest target for mock destinations.
 *
 * The orchestrator validates the ingest of any platform whose stream key is USER_ASSISTED
 * before it will connect — correctly, because for those platforms the key is the only thing
 * LIVETAP has. In mock mode there is no platform to copy a key from, so a clearly-fake,
 * clearly-labelled demo target stands in. It is only ever attached to a destination whose
 * `mock` flag is `true`, and the mock adapter never opens a socket with it.
 */
import type { IngestTarget, PlatformId } from '@livetap/core';

export function demoIngest(platform: PlatformId): IngestTarget {
  return {
    protocol: 'rtmps',
    url: `rtmps://demo.livetap.invalid/${platform}`,
    streamKey: `demo-${platform}-0000`,
  };
}

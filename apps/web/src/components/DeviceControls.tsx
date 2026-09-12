import type { ReactElement } from 'react';
import { Icons, MicOffIcon, Select, Toggle } from '@livetap/ui';
import { useDevices } from '../lib/devices.js';
import { useAppStore } from '../state/store.js';

/**
 * Camera, microphone and screen, with mute.
 *
 * Mute is always available, including while live, and while muted it carries a persistent
 * warning state — a forgotten mute is the most common silent failure in this category
 * (PRODUCT_SPEC §5c, tenet 6).
 */
export function DeviceControls({ live }: { live: boolean }): ReactElement {
  const { cameras, microphones, unsupported } = useDevices();
  const micMuted = useAppStore((s) => s.micMuted);
  const toggleMic = useAppStore((s) => s.toggleMic);
  const screenSharing = useAppStore((s) => s.screenSharing);
  const toggleScreen = useAppStore((s) => s.toggleScreen);

  const cameraOptions =
    cameras.length > 0
      ? cameras.map((c) => ({ value: c.deviceId, label: c.label }))
      : [{ value: 'none', label: unsupported ? 'Test pattern' : 'No camera' }];
  const micOptions =
    microphones.length > 0
      ? microphones.map((m) => ({ value: m.deviceId, label: m.label }))
      : [{ value: 'none', label: 'No microphone' }];

  return (
    <div className="lt-devices">
      <div className="lt-devices__item">
        <span className="lt-devices__icon" aria-hidden="true">
          <Icons.camera size={20} />
        </span>
        <Select label="Camera" options={cameraOptions} defaultValue={cameraOptions[0]?.value} />
      </div>

      <div className="lt-devices__item">
        <span className="lt-devices__icon" aria-hidden="true">
          {micMuted ? <MicOffIcon size={20} /> : <Icons.mic size={20} />}
        </span>
        <Select label="Microphone" options={micOptions} defaultValue={micOptions[0]?.value} />
        <Toggle pressed={micMuted} onPressedChange={() => void toggleMic()}>
          Mute
        </Toggle>
        <p className="lt-devices__hint">
          {micMuted ? 'Muted — viewers hear nothing' : 'Say something — the level should move'}
        </p>
      </div>

      <div className="lt-devices__item">
        <span className="lt-devices__icon" aria-hidden="true">
          <Icons.screen size={20} />
        </span>
        <Toggle pressed={screenSharing} onPressedChange={() => void toggleScreen()}>
          Share my screen
        </Toggle>
        <p className="lt-devices__hint">
          {screenSharing ? 'Sharing your screen' : 'Not sharing'}
          {live ? ' · switching now shows a brief cut to viewers' : ''}
        </p>
      </div>
    </div>
  );
}

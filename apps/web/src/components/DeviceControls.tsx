import type { ChangeEvent, ReactElement } from 'react';
import { Icons, MicOffIcon, Select, Toggle } from '@livetap/ui';
import type { Moment } from '@livetap/core';
import { useDevices } from '../lib/devices.js';
import { useAppStore } from '../state/store.js';

/**
 * Camera, microphone and screen, with mute.
 *
 * Mute is always available, including while live, and while muted it carries a persistent
 * warning state — a forgotten mute is the most common silent failure in this category
 * (PRODUCT_SPEC §5c, tenet 6).
 *
 * The two pickers used to render, open, and change with no handler at all, so after onboarding a
 * creator could not switch camera or microphone by any route in the product. They are wired to
 * `setCameraDevice` / `setMicDevice`, which apply to every Moment: which camera you are using is a
 * property of you, not of the arrangement you happen to be showing.
 */
export function DeviceControls({ live }: { live: boolean }): ReactElement {
  const { cameras, microphones, unsupported } = useDevices();
  const micMuted = useAppStore((s) => s.micMuted);
  const toggleMic = useAppStore((s) => s.toggleMic);
  const screenSharing = useAppStore((s) => s.screenSharing);
  const toggleScreen = useAppStore((s) => s.toggleScreen);
  const setCameraDevice = useAppStore((s) => s.setCameraDevice);
  const setMicDevice = useAppStore((s) => s.setMicDevice);
  const moments = useAppStore((s) => s.moments);
  const activeMomentId = useAppStore((s) => s.production.activeMomentId);
  const active = moments.find((m) => m.id === activeMomentId) ?? moments[0];

  const hasCameras = cameras.length > 0;
  const hasMicrophones = microphones.length > 0;
  const cameraOptions = hasCameras
    ? cameras.map((c) => ({ value: c.deviceId, label: c.label }))
    : [{ value: 'none', label: unsupported ? 'Test pattern' : 'No camera' }];
  const micOptions = hasMicrophones
    ? microphones.map((m) => ({ value: m.deviceId, label: m.label }))
    : [{ value: 'none', label: 'No microphone' }];

  // What the production is actually using right now, so the picker reports the truth after a
  // reload rather than resetting itself to the first device in the list.
  const cameraValue = optionValue(cameraOptions, cameraDeviceOf(active));
  const micValue = optionValue(micOptions, active?.audio.micDeviceId);

  /*
   * A hint is printed when there is something to say and not otherwise.
   *
   * These three cards used to carry a line each in every state, including "Not sharing" under a
   * switch that is visibly off and "Say something — the level should move" beside a level this
   * product does not draw. The second of those is the worse one: it is the interface describing
   * feedback that does not exist, which is the same class of untruth as a disabled control with
   * no visible reason. Silence is the correct state for a control that is doing the obvious
   * thing; the only states that need words are the ones with a consequence.
   */
  const micHint = micMuted ? 'Muted — viewers hear nothing' : null;
  const screenHint = live
    ? 'Switching now shows viewers a brief cut'
    : screenSharing
      ? 'Your screen is in the picture'
      : null;

  return (
    <div className="lt-devices">
      {/*
        No glyph beside the camera picker. `Select` already draws the word "Camera" directly
        above it, and a 20px camera icon next to the word "Camera" is not a second signal, it is
        the same signal drawn twice — while costing 32px of the width the device name needs. Two
        of these three cards were spending a whole row on a picture of their own label.
      */}
      <div className="lt-devices__item">
        <Select
          label="Camera"
          options={cameraOptions}
          value={cameraValue}
          disabled={!hasCameras}
          onChange={(event: ChangeEvent<HTMLSelectElement>) => setCameraDevice(event.target.value)}
        />
      </div>

      <div className="lt-devices__item">
        <Select
          label="Microphone"
          options={micOptions}
          value={micValue}
          disabled={!hasMicrophones}
          onChange={(event: ChangeEvent<HTMLSelectElement>) => setMicDevice(event.target.value)}
        />
        {/*
          The glyph that stays is the one that carries state rather than repeating a word: struck
          through when muted, beside the control that mutes.
        */}
        <div className="lt-devices__switch">
          <span className="lt-devices__icon" aria-hidden="true">
            {micMuted ? <MicOffIcon size={20} /> : <Icons.mic size={20} />}
          </span>
          <Toggle pressed={micMuted} onPressedChange={() => void toggleMic()}>
            Mute
          </Toggle>
        </div>
        {micHint ? <p className="lt-devices__hint lt-devices__hint--warn">{micHint}</p> : null}
      </div>

      <div className="lt-devices__item">
        <div className="lt-devices__switch">
          <span className="lt-devices__icon" aria-hidden="true">
            <Icons.screen size={20} />
          </span>
          <Toggle pressed={screenSharing} onPressedChange={() => void toggleScreen()}>
            Share my screen
          </Toggle>
        </div>
        {screenHint ? <p className="lt-devices__hint">{screenHint}</p> : null}
      </div>
    </div>
  );
}

function cameraDeviceOf(moment: Moment | undefined): string | undefined {
  for (const layer of moment?.layers ?? []) {
    if (layer.kind === 'camera') return layer.deviceId;
  }
  return undefined;
}

/**
 * The stored device may have been unplugged since it was chosen. Falling back to the first option
 * keeps the control honest about what the browser can actually open today.
 */
function optionValue(options: ReadonlyArray<{ value: string }>, stored: string | undefined): string {
  if (stored && options.some((o) => o.value === stored)) return stored;
  return options[0]?.value ?? '';
}

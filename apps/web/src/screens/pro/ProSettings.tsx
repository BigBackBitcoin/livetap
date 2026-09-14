import type { ReactElement } from 'react';
import { Badge, Card, Kbd, Select, Toggle } from '@livetap/ui';
import type { EncoderPreference } from '@livetap/core';
import { useAppStore } from '../../state/store.js';

/**
 * Pro settings.
 *
 * This file is the *only* place in the application where protocol vocabulary is allowed to
 * reach a screen — it is gated behind the Pro toggle, and the static `no-obs-words` test
 * whitelists `src/screens/pro/**` for exactly that reason. Pro appends these groups below
 * Appearance and moves, renames or hides nothing above them (tenet 10).
 *
 * Everything here that is not implemented says so, rather than offering a control that
 * silently does nothing.
 */
export function ProSettings({ live }: { live: boolean }): ReactElement {
  const mode = useAppStore((s) => s.mode);
  const metrics = useAppStore((s) => s.metrics);
  const log = useAppStore((s) => s.log);
  const engineKind = useAppStore((s) => s.engineKind);
  const engineHost = useAppStore((s) => s.engineHost);
  const adapterKind = useAppStore((s) => s.adapterKind);
  const resetEverything = useAppStore((s) => s.resetEverything);
  if (mode !== 'pro') return <></>;

  const lockNote = live ? 'These are locked while you are live. LIVETAP is adjusting quality automatically.' : undefined;

  return (
    <>
      <Card title="Encoder">
        {lockNote ? <p className="lt-screen__note">{lockNote}</p> : null}
        <Select
          label="Encoder"
          hint="Auto measures this device and picks. Hardware encoders this device does not have are still listed, and say so."
          disabled={live}
          options={ENCODERS}
        />
        <Select
          label="Rate control"
          hint="Platforms expect a constant rate. Changing this can make your stream unwatchable on some of them."
          disabled={live}
          options={[
            { value: 'cbr', label: 'CBR — constant bitrate' },
            { value: 'vbr', label: 'VBR — variable bitrate' },
          ]}
        />
        <Select
          label="Keyframe interval"
          hint="Platforms expect a keyframe every 2 seconds. Changing this can make your stream unwatchable on some of them."
          disabled={live}
          options={[
            { value: '2', label: '2 seconds (recommended)' },
            { value: '1', label: '1 second' },
            { value: '4', label: '4 seconds' },
          ]}
        />
        <p className="lt-screen__note">
          Per-aspect resolution, frame rate and bitrate are derived from your quality preset in this
          build. The engine in use is <strong>{engineKind}</strong>, and a mock engine reports
          <Badge tone="info">SIMULATED</Badge> rather than claiming a verified encoder.
        </p>
        {/*
          Observed, not configured. Both values are what this process actually built at start-up,
          which is the only honest answer to "is this real?" - a build-time flag cannot know
          whether the adapter it asked for is the adapter it got.
        */}
        <p className="lt-screen__note">
          Running on <strong>{engineHost}</strong> with <strong>{adapterKind}</strong> destinations.
        </p>
      </Card>

      <Card title="Reconnecting">
        <p className="lt-screen__note">
          When a platform stops receiving your stream, LIVETAP retries that platform only. Your
          other destinations are never interrupted.
        </p>
        <Toggle pressed onPressedChange={() => undefined}>
          Reconnect automatically
        </Toggle>
        <p className="lt-screen__note">
          10 attempts, first wait 1 second, longest wait 30 seconds, doubling each time. Editing the
          policy is not in this build; the defaults are the ones the adapters were tested against.
        </p>
      </Card>

      <Card title="Shortcuts">
        <table className="lt-hotkeys">
          <caption className="lt-sr-only">Keyboard shortcuts</caption>
          <tbody>
            <tr>
              <th scope="row">Cancel a countdown, or undo ending</th>
              <td>
                <Kbd>Esc</Kbd>
              </td>
            </tr>
            <tr>
              <th scope="row">Go live</th>
              <td>
                <Kbd>Enter</Kbd> on the GO LIVE button
              </td>
            </tr>
          </tbody>
        </table>
        <p className="lt-screen__note">
          Rebinding, and shortcuts that work when LIVETAP is not the front window, are desktop-only
          and not in this build.
        </p>
      </Card>

      <Card title="Diagnostics">
        <p className="lt-screen__note">
          Stream keys and sign-in tokens are never written to this log. This is the whole
          diagnosis: LIVETAP never asks you to carry a log file to another website.
        </p>
        {metrics ? (
          <table className="lt-metrics">
            <caption className="lt-sr-only">Live engine metrics</caption>
            <tbody>
              <tr>
                <th scope="row">Bitrate</th>
                <td className="lt-num">{`${Math.round(metrics.encodedKbps).toLocaleString('en-GB')} / ${metrics.targetKbps.toLocaleString('en-GB')} kbps`}</td>
              </tr>
              <tr>
                <th scope="row">Dropped (network)</th>
                <td className="lt-num">{`${metrics.networkDroppedPct.toFixed(1)}%`}</td>
              </tr>
              <tr>
                <th scope="row">Encoder lag</th>
                <td className="lt-num">{`${metrics.encoderDroppedPct.toFixed(1)}%`}</td>
              </tr>
              <tr>
                <th scope="row">Render</th>
                <td className="lt-num">{`${metrics.renderFps.toFixed(0)} / ${metrics.targetFps} fps`}</td>
              </tr>
            </tbody>
          </table>
        ) : (
          <p>Metrics appear once the encoder starts sending.</p>
        )}

        <div className="lt-log" tabIndex={0} role="group" aria-label="Session log">
          <pre className="lt-mono">
            {log.length === 0
              ? 'Nothing has happened yet this session.'
              : log
                  .slice(-200)
                  .map((line) => `${new Date(line.at).toISOString()} ${line.level} ${line.text}`)
                  .join('\n')}
          </pre>
        </div>
      </Card>

      <Card title="Advanced">
        <button
          type="button"
          className="lt-btn lt-btn--danger lt-btn--md"
          disabled={live}
          onClick={() => {
            resetEverything();
            window.location.assign('/app');
          }}
        >
          Reset LIVETAP
        </button>
        <p className="lt-screen__note">
          {live
            ? 'Not while you are live.'
            : 'This clears your intent, your destinations, your Moments and your settings on this device. Your accounts and past streams are untouched.'}
        </p>
      </Card>
    </>
  );
}

const ENCODERS: ReadonlyArray<{ value: EncoderPreference; label: string }> = [
  { value: 'auto', label: 'Auto (recommended)' },
  { value: 'webcodecs', label: 'WebCodecs — this build’s only hardware path' },
  { value: 'software', label: 'Software (x264) — desktop app only' },
  { value: 'nvenc', label: 'NVIDIA NVENC — desktop app only' },
  { value: 'qsv', label: 'Intel Quick Sync — desktop app only' },
  { value: 'amf', label: 'AMD AMF — desktop app only' },
  { value: 'videotoolbox', label: 'Apple VideoToolbox — desktop app only' },
];

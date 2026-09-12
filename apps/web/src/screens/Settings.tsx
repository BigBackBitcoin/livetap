import type { ReactElement } from 'react';
import { Link } from 'react-router';
import { Card, Toggle, useTheme } from '@livetap/ui';
import type { QualityPreset } from '@livetap/core';
import type { ThemePreference } from '@livetap/ui';
import { useAppStore } from '../state/store.js';
import { ProSettings } from './pro/ProSettings.js';

/**
 * Three groups in Simple. Pro appends six more *below* Appearance and moves nothing.
 *
 * Every control applies on change: a Settings screen with a Save button is a Settings screen
 * that can be half-applied.
 */
export function Settings(): ReactElement {
  const mode = useAppStore((s) => s.mode);
  const setMode = useAppStore((s) => s.setMode);
  const quality = useAppStore((s) => s.quality);
  const setQuality = useAppStore((s) => s.setQuality);
  const recordEveryStream = useAppStore((s) => s.recordEveryStream);
  const setRecordEveryStream = useAppStore((s) => s.setRecordEveryStream);
  const restartOnboarding = useAppStore((s) => s.restartOnboarding);
  const live = useAppStore((s) => s.production.state === 'LIVE');
  const { preference, setPreference } = useTheme();

  return (
    <div className="lt-screen">
      <header className="lt-screen__head">
        <h1>Settings</h1>
      </header>

      <Card>
        <Toggle pressed={mode === 'pro'} onPressedChange={(next) => setMode(next ? 'pro' : 'simple')}>
          Pro mode
        </Toggle>
        <p className="lt-screen__note">
          Adds the controls LIVETAP normally decides for you, the arrangement of each Moment, and
          diagnostics. Nothing is hidden — everything you can see now stays exactly where it is.
        </p>
      </Card>

      <Card title="Quality">
        <Segmented
          label="Quality"
          value={quality}
          disabled={live}
          onChange={(next) => setQuality(next as QualityPreset)}
          options={[
            { value: 'auto', label: 'Auto' },
            { value: '720p30', label: '720p' },
            { value: '1080p30', label: '1080p' },
            { value: '1080p60', label: '1080p60' },
          ]}
        />
        <p className="lt-screen__note">
          {live
            ? 'Locked while you are live. LIVETAP is adjusting quality automatically.'
            : 'Auto measures your connection and your computer and keeps adjusting while you stream.'}
        </p>
      </Card>

      <Card title="Recording">
        <Toggle pressed={recordEveryStream} onPressedChange={setRecordEveryStream}>
          Record every stream
        </Toggle>
        <p className="lt-screen__note">
          A copy is kept while you stream, and it keeps going even if a platform drops. In the
          browser it is saved when the stream ends, and you download it from Recordings. For long
          streams, use the desktop app.
        </p>
      </Card>

      <Card title="Appearance">
        <Segmented
          label="Theme"
          value={preference}
          onChange={(next) => setPreference(next as ThemePreference)}
          options={[
            { value: 'system', label: 'System' },
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ]}
        />
        <p className="lt-screen__note">
          {preference === 'system'
            ? 'Following your computer’s appearance setting. LIVETAP does this until you choose, and a computer that does not ask for light gets the dark palette.'
            : `You chose ${preference}. LIVETAP keeps it on every screen until you change it back to System.`}
        </p>
      </Card>

      <ProSettings live={live} />

      <Card title="About">
        <p>LIVETAP 0.1.0 · MIT licence · built in public.</p>
        <ul className="lt-linklist">
          <li>
            <Link to="/app/start" onClick={() => restartOnboarding()}>
              Run setup again
            </Link>
          </li>
          <li>
            <Link to="/privacy">What LIVETAP never collects</Link>
          </li>
          <li>
            <a href="https://github.com/BigBackBitcoin/livetap" rel="noreferrer noopener">
              Read the code
            </a>
          </li>
        </ul>
      </Card>
    </div>
  );
}

/** A real radio group, so the mobile sheet and the desktop segmented control say the same thing. */
function Segmented({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  onChange: (next: string) => void;
  disabled?: boolean;
}): ReactElement {
  return (
    <div className="lt-segmented" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          aria-disabled={disabled || undefined}
          className={['lt-segmented__item', 'lt-touch', value === option.value ? 'is-active' : '']
            .filter(Boolean)
            .join(' ')}
          onClick={() => !disabled && onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

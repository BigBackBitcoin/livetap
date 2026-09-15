import type { ReactElement } from 'react';
import { Link } from 'react-router';
import { Card, Toggle, useTheme } from '@livetap/ui';
import type { QualityPreset } from '@livetap/core';
import type { ThemePreference } from '@livetap/ui';
import { useAppStore } from '../state/store.js';
import { replayTour } from '../components/Tour.js';
import { ProSettings } from './pro/ProSettings.js';

/**
 * Three groups in Simple. Pro appends six more *below* Appearance and moves nothing.
 *
 * Every control applies on change: a Settings screen with a Save button is a Settings screen
 * that can be half-applied.
 */
export function Settings(): ReactElement {
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

      {/*
        Pro mode's switch lives in the shell, on every route, and is on screen right now in the
        nav beside this card. A second switch here was a second authoritative control for one
        piece of state: flip either and the other moves, which is the shape of control the
        interaction-ownership rule exists to forbid. The 29-word explanation went with it - what
        Pro mode does is visible the instant it is switched on.
      */}
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
            ? 'Locked while live.'
            : 'Auto adjusts while you stream.'}
        </p>
      </Card>

      <Card title="Recording">
        <Toggle pressed={recordEveryStream} onPressedChange={setRecordEveryStream}>
          Record every stream
        </Toggle>
        <p className="lt-screen__note">
          Kept while you stream, even if a platform drops. Download it from Recordings.
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
            ? 'Following your computer.'
            : `Set to ${preference}.`}
        </p>
      </Card>

      <ProSettings live={live} />

      <Card title="About">
        <p>LIVETAP 0.1.0 · MIT licence · built in public.</p>
        <ul className="lt-linklist">
          <li>
            {/*
              The Quick Tour is offered once and then never again, which is the directive's own
              rule (§26: "never repeatedly show instructional text"). A rule like that needs a
              door back in, or the one creator who dismissed it by reflex has lost it for good.
              It is a button rather than a link because it changes state here and navigates
              nowhere: the tour appears on Studio the next time this person is on it.
            */}
            <button type="button" className="lt-textlink lt-touch" onClick={() => replayTour()}>
              Play the quick tour again
            </button>
          </li>
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

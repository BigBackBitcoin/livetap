import { useState } from 'react';
import type { ReactElement } from 'react';
import { Badge, Button, Card, Sheet, StatusChip, Toggle } from '@livetap/ui';
import { PLATFORM_PROFILES } from '@livetap/adapters';
import { chipLabel, statusText } from '../components/DestinationChips.js';
import { DestinationErrorCard, NoticeCards } from '../components/NoticeCards.js';
import { StreamKeyForm } from '../components/StreamKeyForm.js';
import { ProDestinationLine, ProPlatformNotes } from './pro/ProDestinationLine.js';
import { COPY } from '../lib/copy.js';
import { PLATFORM_ORDER, platformStatus } from '../lib/platformStatus.js';
import { useAppStore } from '../state/store.js';

/**
 * Where the promise's first sentence is kept.
 *
 * The list of platforms is never filtered: absence would read as "not supported yet", when for
 * LinkedIn it means "not possible". Every badge is derived from the capability matrix, so the
 * screen cannot drift from what the adapters can actually do (tenet 8).
 */
/**
 * "YouTube · YouTube". A destination connected without an account name defaults its label to the
 * platform's own display name, and concatenating the two produced a title that reads like a bug.
 * One name when they are the same name.
 */
export function destinationTitle(displayName: string, label: string): string {
  return label.trim() === displayName ? displayName : `${displayName} · ${label}`;
}

export function Destinations(): ReactElement {
  const destinations = useAppStore((s) => s.destinations);
  const mockMode = useAppStore((s) => s.mockMode);
  const mode = useAppStore((s) => s.mode);
  const connectPlatform = useAppStore((s) => s.connectPlatform);
  const addCustom = useAppStore((s) => s.addCustomDestination);
  const setEnabled = useAppStore((s) => s.setDestinationEnabled);
  const remove = useAppStore((s) => s.removeDestination);
  const live = useAppStore((s) => s.production.state === 'LIVE');

  const [sheetOpen, setSheetOpen] = useState(false);
  const [keyFlow, setKeyFlow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  return (
    <div className="lt-screen">
      <header className="lt-screen__head">
        <div>
          <h1>Destinations</h1>
          <p>LIVETAP streams to all the destinations you switch on, at once.</p>
        </div>
        <Button variant="primary" onClick={() => setSheetOpen(true)}>
          {`+ ${COPY.addDestination}`}
        </Button>
      </header>

      <NoticeCards />

      {destinations.length === 0 ? (
        <Card title="No destinations yet">
          <p>
            A destination is one place your stream goes — a YouTube channel, a Twitch channel,
            anything that accepts a stream. Connect one and LIVETAP does the rest.
          </p>
          <Button variant="primary" onClick={() => setSheetOpen(true)}>
            Add your first destination
          </Button>
        </Card>
      ) : (
        <ul className="lt-destlist">
          {destinations.map((snap) => {
            const profile = PLATFORM_PROFILES[snap.config.platform];
            const isLive = snap.state === 'LIVE' || snap.state === 'DEGRADED';
            return (
              <li key={snap.config.id}>
                <Card
                  className={snap.config.mock ? 'lt-destcard lt-destcard--demo' : 'lt-destcard'}
                  title={
                    <span className="lt-destcard__title">
                      {destinationTitle(profile.displayName, snap.config.label)}
                      {snap.config.mock ? <Badge tone="info">{COPY.demo}</Badge> : null}
                    </span>
                  }
                  actions={
                    <Toggle
                      pressed={snap.config.enabled}
                      onPressedChange={(next) => setEnabled(snap.config.id, next)}
                    >
                      In your next stream
                    </Toggle>
                  }
                >
                  <StatusChip
                    state={snap.state}
                    label={chipLabel(snap.state)}
                    status={statusText(snap)}
                  />
                  <p className="lt-destcard__meta">
                    {`${snap.config.aspectRatio} · up to ${profile.recommended.maxHeight}p${profile.recommended.maxFps}`}
                  </p>
                  {mode === 'pro' ? (
                    <>
                      <ProDestinationLine config={snap.config} />
                      <ProPlatformNotes notes={profile.eligibilityNotes} />
                    </>
                  ) : null}
                  {snap.watchUrl ? (
                    <p>
                      <a className="lt-textlink" href={snap.watchUrl} rel="noreferrer noopener">
                        Watch this destination
                      </a>
                    </p>
                  ) : null}

                  <DestinationErrorCard snapshot={snap} />

                  <div className="lt-destcard__actions">
                    {confirmRemove === snap.config.id ? (
                      <>
                        <p>
                          {`Remove ${snap.config.label}? Its stream key is deleted from this device. Your account and past streams are untouched.`}
                        </p>
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => {
                            void remove(snap.config.id);
                            setConfirmRemove(null);
                          }}
                        >
                          Remove
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setConfirmRemove(null)}>
                          Keep
                        </Button>
                      </>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={isLive}
                        onClick={() => setConfirmRemove(snap.config.id)}
                      >
                        {isLive ? 'Stop it first' : 'Remove'}
                      </Button>
                    )}
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      {live ? (
        <p className="lt-screen__note">
          A destination added now lands ready and joins your next stream, not this one.
        </p>
      ) : null}

      <Sheet
        open={sheetOpen}
        onClose={() => {
          setSheetOpen(false);
          setKeyFlow(false);
        }}
        title={COPY.addDestination}
      >
        <p>
          LIVETAP can stream to all of these at once. How you connect depends on what each platform
          allows.
        </p>

        {keyFlow ? (
          <StreamKeyForm
            busy={busy}
            onCancel={() => setKeyFlow(false)}
            onSubmit={async (value) => {
              setBusy(true);
              await addCustom({
                label: value.label,
                url: value.url,
                streamKey: value.streamKey,
                aspect: value.aspect,
              });
              setBusy(false);
              setKeyFlow(false);
              setSheetOpen(false);
            }}
          />
        ) : (
          <ul className="lt-addlist">
            {PLATFORM_ORDER.map((id) => {
              const status = platformStatus(id);
              return (
                <li key={id}>
                  <button
                    type="button"
                    className="lt-addrow lt-touch"
                    aria-disabled={status.blocked || undefined}
                    aria-describedby={status.blocked ? `lt-addwhy-${id}` : undefined}
                    onClick={() => {
                      if (status.blocked) return;
                      if (id === 'custom' || (!mockMode && status.method === 'key')) {
                        setKeyFlow(true);
                        return;
                      }
                      void connectPlatform(id);
                      setSheetOpen(false);
                    }}
                  >
                    <span className="lt-addrow__name">{status.profile.displayName}</span>
                    <span className="lt-addrow__badges">
                      <Badge tone={status.tone}>{status.actionLabel}</Badge>
                      {mockMode && !status.blocked ? <Badge tone="info">{COPY.demo}</Badge> : null}
                    </span>
                    <span className="lt-addrow__summary">{status.summary}</span>
                    {status.blocked ? (
                      <span className="lt-addrow__why" id={`lt-addwhy-${id}`}>
                        {status.blockedReason}
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <p className="lt-screen__note">
          Some platforms require your account to meet their own rules before you can go live.
          LIVETAP checks what it can and tells you before you try.
        </p>
      </Sheet>
    </div>
  );
}

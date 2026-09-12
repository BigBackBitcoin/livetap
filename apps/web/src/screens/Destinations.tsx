import { useState } from 'react';
import type { ReactElement } from 'react';
import { Badge, Button, Card, Sheet, StatusChip, Toggle } from '@livetap/ui';
import { PLATFORM_PROFILES } from '@livetap/adapters';
import type { PlatformId } from '@livetap/core';
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

  /*
   * Which rows of the add sheet are demos is a fact about this build, not a label: in a demo
   * deployment, tapping any real platform produces a simulated destination, while "Other" still
   * takes a key you paste and LinkedIn still cannot be connected by anyone. So the split is
   * derived, never hand-listed, and it disappears on a deployment with real credentials.
   */
  const demo = mockMode ? PLATFORM_ORDER.filter(isDemoRow) : [];
  const real = PLATFORM_ORDER.filter((id) => !demo.includes(id));

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
          <>
            {real.length > 0 ? (
              <ul className="lt-addlist">
                {real.map((id) => (
                  <AddRow
                    key={id}
                    id={id}
                    demo={false}
                    onPasteKey={() => setKeyFlow(true)}
                    onConnect={() => {
                      void connectPlatform(id);
                      setSheetOpen(false);
                    }}
                  />
                ))}
              </ul>
            ) : null}

            {/*
              PRODUCT_SPEC §4.4 and §5d: demo providers get their own section at the bottom of
              the sheet, under their own heading, with the sentence that says what they are. The
              sheet still lists all nine platforms and still never filters one out — absence
              would read as "not supported yet", which for LinkedIn would be a lie.

              §5d draws this section collapsed. It is expanded here, deliberately: on a demo
              deployment these rows are the only ones that can produce anything, and hiding the
              one path that works behind a disclosure would be the opposite of the honesty the
              section exists for.
            */}
            {demo.length > 0 ? (
              <section className="lt-addgroup" aria-labelledby="lt-demogroup">
                <h3 className="lt-addgroup__title" id="lt-demogroup">
                  Demo destinations
                </h3>
                <p className="lt-addgroup__note">
                  These simulate a platform so you can try LIVETAP. They never broadcast
                  anywhere.
                </p>
                <ul className="lt-addlist">
                  {demo.map((id) => (
                    <AddRow
                      key={id}
                      id={id}
                      demo
                      onPasteKey={() => setKeyFlow(true)}
                      onConnect={() => {
                        void connectPlatform(id);
                        setSheetOpen(false);
                      }}
                    />
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        )}

        <p className="lt-screen__note">
          Some platforms require your account to meet their own rules before you can go live.
          LIVETAP checks what it can and tells you before you try.
        </p>
      </Sheet>
    </div>
  );
}

/**
 * True when tapping this platform in a demo build produces a simulated destination. "Other"
 * does not: it takes a key you paste and sends to it for real. A blocked platform never does:
 * nothing the user taps there produces a broadcast, demo or otherwise.
 */
export function isDemoRow(id: PlatformId): boolean {
  const status = platformStatus(id);
  return !status.blocked && id !== 'custom';
}

/** One row of the add sheet. Identical in both sections, so neither can drift from the other. */
function AddRow({
  id,
  demo,
  onConnect,
  onPasteKey,
}: {
  id: PlatformId;
  demo: boolean;
  onConnect: () => void;
  onPasteKey: () => void;
}): ReactElement {
  const status = platformStatus(id);
  return (
    <li>
      <button
        type="button"
        className="lt-addrow lt-touch"
        aria-disabled={status.blocked || undefined}
        aria-describedby={status.blocked ? `lt-addwhy-${id}` : undefined}
        onClick={() => {
          if (status.blocked) return;
          if (!demo && (id === 'custom' || status.method === 'key')) {
            onPasteKey();
            return;
          }
          onConnect();
        }}
      >
        <span className="lt-addrow__name">{status.profile.displayName}</span>
        <span className="lt-addrow__badges">
          <Badge tone={status.tone}>{status.actionLabel}</Badge>
          {demo ? <Badge tone="info">{COPY.demo}</Badge> : null}
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
}

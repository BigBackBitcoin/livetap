import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { Link } from 'react-router';
import { Badge, Button, Card } from '@livetap/ui';
import { COPY } from '../lib/copy.js';
import { dateTime, durationSummary, fileSize } from '../lib/format.js';
import { useAppStore } from '../state/store.js';

/**
 * A recording the user cannot find is a lost recording, and that is the most trust-destroying
 * event in this category. So every recording this session made is listed, newest first, with
 * exactly one action per row — and when there is no file to hand over, the row says so rather
 * than offering a button that does nothing.
 */
export function Recordings(): ReactElement {
  const recordings = useAppStore((s) => s.recordings);
  const recordEveryStream = useAppStore((s) => s.recordEveryStream);
  const recording = useAppStore((s) => s.production.recording);

  return (
    <div className="lt-screen">
      <header className="lt-screen__head">
        <div>
          <h1>Recordings</h1>
          <p>Every stream is recorded on this device unless you turn it off.</p>
        </div>
      </header>

      {!recordEveryStream ? (
        <p className="lt-screen__note">
          Recording is currently off.{' '}
          <Link className="lt-textlink" to="/app/settings">
            Turn it on
          </Link>
        </p>
      ) : null}

      {recordings.length === 0 ? (
        <Card title="No recordings yet">
          <p>
            LIVETAP records every stream so you always have your own copy. Your first recording will
            appear here.
          </p>
          <Link className="lt-btn lt-btn--primary lt-btn--md" to="/app/studio">
            Go to Studio
          </Link>
        </Card>
      ) : (
        <ul className="lt-reclist">
          {recordings.map((item) => (
            <li key={item.id}>
              <Card
                title={
                  <span>
                    {dateTime(item.startedAt)}
                    {item.demo ? <Badge tone="info">{COPY.demo}</Badge> : null}
                  </span>
                }
              >
                <p className="lt-num">
                  {item.endedAt
                    ? `${durationSummary(item.endedAt - item.startedAt)}${item.blob ? ` · ${fileSize(item.blob.size)}` : ''}`
                    : `Recording now`}
                </p>
                <p className="lt-screen__note">
                  {item.destinations.length > 0 ? item.destinations.join(', ') : 'Not streamed'}
                </p>
                <RecordingAction
                  blob={item.blob}
                  demo={item.demo}
                  name={`livetap-${new Date(item.startedAt).toISOString().slice(0, 19).replace(/[:T]/g, '-')}`}
                />
              </Card>
            </li>
          ))}
        </ul>
      )}

      {recording ? (
        <p className="lt-screen__note">A recording is running. It appears above while it is being made.</p>
      ) : null}
    </div>
  );
}

/**
 * The download is an object URL created on demand and revoked when the row unmounts, so a long
 * session never holds a pile of blobs alive twice.
 */
function RecordingAction({
  blob,
  demo,
  name,
}: {
  blob: Blob | undefined;
  demo: boolean;
  name: string;
}): ReactElement {
  const [href, setHref] = useState<string | null>(null);

  useEffect(() => {
    if (!blob || typeof URL.createObjectURL !== 'function') return undefined;
    const url = URL.createObjectURL(blob);
    setHref(url);
    return () => {
      URL.revokeObjectURL(url);
      setHref(null);
    };
  }, [blob]);

  if (href) {
    return (
      <a className="lt-btn lt-btn--primary lt-btn--md" href={href} download={`${name}.webm`}>
        {COPY.download}
      </a>
    );
  }

  return (
    <>
      <Button variant="secondary" disabled>
        {COPY.download}
      </Button>
      <p className="lt-screen__note">
        {demo
          ? 'This was a demo stream, so there is no file to download — nothing was captured or sent anywhere.'
          : 'This recording has no file on this device. In the browser a recording is written when the stream ends.'}
      </p>
    </>
  );
}

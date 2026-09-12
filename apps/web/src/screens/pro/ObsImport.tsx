import { useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { Button, Card, Sheet } from '@livetap/ui';
import type { ObsImportResult } from '@livetap/core';
import { useAppStore } from '../../state/store.js';
import { coverageLine, momentsToAppend, placementClaim, readObsCollection } from './obsSceneImport.js';

/**
 * "Import from OBS…" — Pro mode, on the Moments screen.
 *
 * The whole design of this feature is the truth report. An importer that silently converts what
 * it can and says nothing about the rest is how somebody goes live with an overlay missing, and
 * "it imported fine" is a sentence LIVETAP is not allowed to say on this evidence. So the file
 * is read, nothing is added, and the user is shown exactly three lists — what will come across,
 * what will not and why, and what came across with an assumption attached — before a single
 * Moment is created. The primary action is then a confirmation of something already described,
 * not a leap.
 *
 * Nothing is uploaded. The file is read in the browser with `File.text()`; no bytes leave the
 * machine, which is also why this needs no API and no permission.
 */
export function ObsImportCard(): ReactElement {
  const moments = useAppStore((s) => s.moments);
  const upsertMoment = useAppStore((s) => s.upsertMoment);

  const input = useRef<HTMLInputElement | null>(null);
  const [result, setResult] = useState<ObsImportResult | null>(null);
  const [problem, setProblem] = useState<{ what: string; why: string } | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  const [reading, setReading] = useState(false);

  const close = (): void => {
    setResult(null);
    setProblem(null);
  };

  async function onPick(file: File | undefined): Promise<void> {
    if (!file) return;
    setReading(true);
    setAdded(null);
    try {
      const outcome = readObsCollection(await file.text());
      if (outcome.ok) {
        setProblem(null);
        setResult(outcome.result);
      } else {
        setResult(null);
        setProblem({ what: outcome.what, why: outcome.why });
      }
    } catch {
      setResult(null);
      setProblem({
        what: 'That file could not be read.',
        why: 'The browser could not open it — it may have been moved or renamed since you picked it. Try choosing it again.',
      });
    } finally {
      setReading(false);
      // Allow the same file to be picked twice in a row after a fix.
      if (input.current) input.current.value = '';
    }
  }

  function confirm(): void {
    if (!result) return;
    const toAdd = momentsToAppend(result, moments);
    for (const moment of toAdd) upsertMoment(moment);
    setAdded(
      toAdd.length === 1
        ? `Added “${toAdd[0]?.name}”. It is in your Moment strip now.`
        : `Added ${toAdd.length} Moments. They are in your Moment strip now.`,
    );
    close();
  }

  return (
    <Card title="Bring your OBS setup across">
      <p className="lt-screen__note">
        LIVETAP can read an OBS scene collection and turn each scene into a Moment. It will show
        you what it can and cannot bring across before it changes anything. Your file is read on
        this computer and is not sent anywhere.
      </p>

      <input
        ref={input}
        className="lt-sr-only"
        type="file"
        accept=".json,application/json"
        aria-label="Choose an OBS scene collection file"
        onChange={(event) => void onPick(event.currentTarget.files?.[0])}
      />

      <Button variant="secondary" loading={reading} onClick={() => input.current?.click()}>
        Import from OBS…
      </Button>

      {added ? (
        <p className="lt-screen__note" role="status">
          {added}
        </p>
      ) : null}

      {/*
        A failure to read the file is a four-field statement like every other failure in the
        product: what happened, why, and what to do. It is not a parser message.
      */}
      {problem ? (
        <div className="lt-obsimport__problem" role="alert">
          <p className="lt-obsimport__what">{problem.what}</p>
          <p className="lt-screen__note">{problem.why}</p>
        </div>
      ) : null}

      <Sheet
        open={result !== null}
        onClose={close}
        title="What LIVETAP found in your file"
        footer={
          <>
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button variant="primary" onClick={confirm}>
              Add these Moments
            </Button>
          </>
        }
      >
        {result ? <ImportReportBody result={result} /> : null}
      </Sheet>
    </Card>
  );
}

function ImportReportBody({ result }: { result: ObsImportResult }): ReactElement {
  const { report } = result;
  return (
    <div className="lt-obsimport">
      <p className="lt-obsimport__summary">{report.summary}</p>
      <p>{placementClaim(report)}</p>
      <p className="lt-screen__note">{coverageLine(report)}</p>

      <section aria-labelledby="lt-obs-in">
        <h3 id="lt-obs-in">What becomes a Moment</h3>
        <ul className="lt-obsimport__list">
          {report.imported.map((entry) => (
            <li key={entry.scene}>
              <strong>{entry.scene}</strong>
              <span className="lt-screen__note">
                {entry.layers === 1 ? ' — 1 piece' : ` — ${entry.layers} pieces`}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {report.skipped.length > 0 ? (
        <section aria-labelledby="lt-obs-out">
          <h3 id="lt-obs-out">What does not come across, and why</h3>
          <ul className="lt-obsimport__list">
            {report.skipped.map((entry, index) => (
              <li key={`${entry.scene ?? ''}-${entry.source}-${index}`}>
                <strong>{entry.source}</strong>
                <span className="lt-screen__note">
                  {entry.scene ? ` (in ${entry.scene})` : ''} — {entry.reason}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {report.warnings.length > 0 ? (
        <section aria-labelledby="lt-obs-check">
          <h3 id="lt-obs-check">Worth checking afterwards</h3>
          <ul className="lt-obsimport__list">
            {report.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className="lt-screen__note">
        Nothing has changed yet. The six Moments LIVETAP gave you stay exactly as they are — these
        are added alongside them, and you can delete any of them afterwards.
      </p>
    </div>
  );
}

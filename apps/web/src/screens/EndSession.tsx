/**
 * "End this session and forget me" — the control that makes `destroySession` reachable.
 *
 * LIVETAP has no accounts, so this is the only thing in the product that means *leave*. Everything
 * else a visitor can press changes what the next broadcast does; this changes whether there is a
 * next visitor who can see anything of theirs.
 *
 * THE RULE THIS SCREEN EXISTS TO OBEY: it reports what the cleanup actually observed, and never
 * more. `destroySession` was deliberately built to return three distinguishable outcomes — it
 * worked, it partly worked and here is what survived, or it could not look and therefore cannot
 * say. A screen that collapses those into "Forgotten" puts back exactly the lie the report was
 * written to prevent, and it would be a comfortable lie: `clean: false` with an unreadable store
 * looks identical to success from the outside.
 *
 * So there are three endings here and not one, and the wording of each is load-bearing:
 *
 *   clean                        "Forgotten."            an observation, stated plainly
 *   readable, something survived "Mostly forgotten."     names what is left, because a person
 *                                                        cannot clear by hand what they cannot see
 *   unreadable                   "Could not confirm."    not a failure and not a success — the
 *                                                        browser refused to be read, which happens
 *                                                        in private mode and on blocked site data
 */
import { useState, type ReactElement } from 'react';
import { Link } from 'react-router';
import { Button, Card } from '@livetap/ui';
import { useAppStore } from '../state/store.js';
import { isOnAir } from '../state/session.js';
import type { DestroyReport } from '../state/session.js';

type Stage = 'idle' | 'confirming' | 'working' | 'done';

export function EndSession(): ReactElement {
  const endSession = useAppStore((s) => s.endSession);
  const sessionPhase = useAppStore((s) => s.sessionPhase);
  const destinationCount = useAppStore((s) => s.destinations.length);
  const [stage, setStage] = useState<Stage>('idle');
  const [report, setReport] = useState<DestroyReport | null>(null);

  const onAir = isOnAir(sessionPhase());

  async function run(): Promise<void> {
    setStage('working');
    const result = await endSession();
    setReport(result);
    setStage('done');
  }

  if (stage === 'done' && report) return <Outcome report={report} />;

  return (
    <Card title="End this session">
      <p>
        LIVETAP never asked you for an account, so there is nothing to sign out of. Ending the
        session removes what this browser is holding: your destinations, any stream keys, and any
        accounts you connected.
      </p>

      {onAir ? (
        /*
          Refused while on air rather than hidden. A control that vanishes mid-broadcast reads as a
          bug; one that explains itself reads as a product. `endSession` refuses independently —
          this is the explanation, not the enforcement.
        */
        <p className="lt-screen__note" role="status">
          You are still live. End the broadcast first — clearing a stream key now would leave a
          destination running with no way left to reach it.
        </p>
      ) : stage === 'confirming' ? (
        <div className="lt-endsession__confirm">
          <p>
            {destinationCount > 0
              ? `This removes ${destinationCount} ${destinationCount === 1 ? 'destination' : 'destinations'} and everything saved with them. It cannot be undone.`
              : 'This clears everything saved in this browser. It cannot be undone.'}
          </p>
          <div className="lt-endsession__actions">
            <Button variant="danger" onClick={() => void run()}>
              End session and forget me
            </Button>
            <Button variant="ghost" onClick={() => setStage('idle')}>
              Keep my setup
            </Button>
          </div>
        </div>
      ) : (
        <Button
          variant="secondary"
          disabled={stage === 'working'}
          onClick={() => setStage('confirming')}
        >
          {stage === 'working' ? 'Ending…' : 'End session and forget me'}
        </Button>
      )}
    </Card>
  );
}

/**
 * What actually happened, in the product's own voice.
 *
 * Each branch is a different claim about the world and they are not interchangeable. The one that
 * matters most is the third: a store that could not be read is NOT a store that was emptied, and
 * saying so is the difference between this product's privacy promise being true and being
 * plausible.
 */
function Outcome({ report }: { report: DestroyReport }): ReactElement {
  if (report.clean) {
    return (
      <Card title="Forgotten">
        <p>
          Nothing of yours is left in this browser. Your destinations, stream keys and connected
          accounts are gone, and nothing was ever sent to a LIVETAP server, because there is no
          LIVETAP account to send it to.
        </p>
        <Link className="lt-textlink" to="/app/start">
          Start again
        </Link>
      </Card>
    );
  }

  if (!report.storageReadable) {
    return (
      <Card title="Could not confirm">
        <p>
          Everything was cleared, but this browser would not let LIVETAP read its storage back, so
          there is no way to check the result. That usually means private browsing or blocked site
          data.
        </p>
        <p className="lt-screen__note">
          Nothing is claimed here that was not observed. To be certain, clear site data for this
          page in your browser settings.
        </p>
        <Link className="lt-textlink" to="/app/start">
          Start again
        </Link>
      </Card>
    );
  }

  return (
    <Card title="Mostly forgotten">
      <p>
        Your stream keys and connected accounts were cleared. These could not be removed and are
        still in this browser:
      </p>
      <ul className="lt-screen__note">
        {report.storageRemaining.map((key) => (
          <li key={key}>{key}</li>
        ))}
      </ul>
      <p className="lt-screen__note">
        A full or locked browser store usually causes this. Clearing site data for this page removes
        them.
      </p>
      <Link className="lt-textlink" to="/app/start">
        Start again
      </Link>
    </Card>
  );
}

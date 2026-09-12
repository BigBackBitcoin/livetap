import { useState } from 'react';
import type { ReactElement } from 'react';
import { Badge, Button, Card, MomentCard, MomentIcon, Toggle } from '@livetap/ui';
import { INTENT_PROFILES } from '@livetap/core';
import type { Layer, Moment as MomentType, NormalizedRect } from '@livetap/core';
import { PreviewCanvas } from '../components/PreviewCanvas.js';
import { describe } from '../components/PreviewCanvas.js';
import { ObsImportCard } from './pro/ObsImport.js';
import { useAppStore } from '../state/store.js';

/**
 * One noun, not four (tenet 3). A Moment is one thing viewers see.
 *
 * Simple picks a layout from a picture. Pro gets the same six templates in the same place plus
 * the arrangement as numbers — visibility, order and placement — because every drag has to have
 * a keyboard and a numeric equivalent (PRODUCT_SPEC §5e accessibility notes). There is no canvas
 * dragging in this build, and the numbers are not a fallback for it: they are the primary,
 * accessible interface, and they are exact.
 */
const TEMPLATES = [
  {
    id: 'full',
    name: 'Full frame',
    result: 'Your camera fills the frame.',
    rect: { x: 0, y: 0, w: 1, h: 1 } as NormalizedRect,
  },
  {
    id: 'corner',
    name: 'Camera corner',
    result: 'Your screen fills the frame with your camera in the bottom-right corner.',
    rect: { x: 0.73, y: 0.68, w: 0.24, h: 0.29 } as NormalizedRect,
  },
  {
    id: 'side',
    name: 'Side by side',
    result: 'Two equal panes, you on the left.',
    rect: { x: 0.02, y: 0.2, w: 0.47, h: 0.6 } as NormalizedRect,
  },
  {
    id: 'strip',
    name: 'Camera strip',
    result: 'Your screen on top, you in a full-width strip beneath it.',
    rect: { x: 0.05, y: 0.64, w: 0.9, h: 0.3 } as NormalizedRect,
  },
  {
    id: 'card',
    name: 'Just a card',
    result: 'Background and words only — no camera.',
    rect: null,
  },
] as const;

export function Moments(): ReactElement {
  const moments = useAppStore((s) => s.moments);
  const activeId = useAppStore((s) => s.production.activeMomentId);
  const setMoment = useAppStore((s) => s.setMoment);
  const aspect = useAppStore((s) => s.aspect);
  const mode = useAppStore((s) => s.mode);
  const intent = useAppStore((s) => s.intent);
  const live = useAppStore((s) => s.production.state === 'LIVE');

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = moments.find((m) => m.id === (selectedId ?? activeId)) ?? moments[0];

  return (
    <div className="lt-screen">
      <header className="lt-screen__head">
        <div>
          <h1>Moments</h1>
          <p>
            A Moment is one thing viewers see. LIVETAP gives you six; change them however you like.
          </p>
        </div>
      </header>

      {live ? (
        <p className="lt-screen__live">
          You are live. Changes here are visible to viewers straight away.
        </p>
      ) : null}

      <ul className="lt-momentstrip">
        {moments.map((moment) => (
          <li key={moment.id}>
            <MomentCard
              /* The icon set, not emoji — PRODUCT_REVIEW P2-5. */
              icon={<MomentIcon moment={moment.id} size={32} />}
              name={moment.name}
              active={selected?.id === moment.id}
              onSelect={() => setSelectedId(moment.id)}
              meta={activeId === moment.id ? 'Viewers see this' : undefined}
            />
          </li>
        ))}
      </ul>

      <div className="lt-moments__body">
        <div>
          <PreviewCanvas aspect={aspect} live={live} muted={false} />
          <p className="lt-screen__note">
            Placement is saved per shape, so your vertical stream can be framed differently from
            your widescreen one.
          </p>
          <p className="lt-screen__note">{describe(selected)}</p>
          {activeId !== selected?.id && selected ? (
            <Button variant="secondary" onClick={() => void setMoment(selected.id)}>
              {`Show ${selected.name} to viewers`}
            </Button>
          ) : null}
        </div>

        <div className="lt-moments__panel">
          <Card title="Layout">
            <ul className="lt-templates" role="radiogroup" aria-label="Layout">
              {TEMPLATES.map((template) => (
                <li key={template.id}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={false}
                    aria-label={`${template.name} — ${template.result}`}
                    className="lt-template lt-touch"
                    onClick={() => selected && applyTemplate(selected, template.rect)}
                  >
                    <span className="lt-template__name">{template.name}</span>
                    <span className="lt-template__result">{template.result}</span>
                  </button>
                </li>
              ))}
            </ul>
            {intent ? (
              <p className="lt-screen__note">
                {`These are arranged for ${INTENT_PROFILES[intent].title.toLowerCase()} — ${INTENT_PROFILES[intent].tagline}`}
              </p>
            ) : null}
          </Card>

          <Card title="Sound">
            <p>{`${selected?.audio.micMuted ? 'Muted' : 'Not muted'} · computer sound ${selected?.audio.systemAudio ? 'included' : 'off'}`}</p>
            <Toggle
              pressed={Boolean(selected?.audio.systemAudio)}
              onPressedChange={(next) => selected && setSystemAudio(selected, next)}
            >
              Include computer sound
            </Toggle>
            <p className="lt-screen__note">
              Sound from your computer — music, game audio, a video you play.
            </p>
          </Card>

          {/*
            Pro additions only ever append, and this one is the most additive thing in the
            product: an OBS user's own arrangement, read off their own file, with a truth report
            in front of it (PRODUCT_SPEC §5e, north-star §14 — what would make an OBS user
            *switch* rather than merely try).
          */}
          {mode === 'pro' ? <ObsImportCard /> : null}
          {mode === 'pro' && selected ? <ProLayerList moment={selected} /> : null}
        </div>
      </div>
    </div>
  );
}

/* Pro additions only ever append. Nothing above this line moves. */
function ProLayerList({ moment }: { moment: MomentType }): ReactElement {
  return (
    <Card title="What this Moment is made of">
      <p className="lt-screen__note">The top row is in front.</p>
      <table className="lt-layertable">
        <caption className="lt-sr-only">{`Parts of ${moment.name}`}</caption>
        <thead>
          <tr>
            <th scope="col">Part</th>
            <th scope="col">Shown</th>
            <th scope="col">Order</th>
            <th scope="col">Placement</th>
          </tr>
        </thead>
        <tbody>
          {[...moment.layers]
            .sort((a, b) => b.z - a.z)
            .map((layer) => (
              <tr key={layer.id}>
                <td>{layer.name}</td>
                <td>
                  {layer.visible ? <Badge tone="success">Shown</Badge> : <Badge>Hidden</Badge>}
                </td>
                <td className="lt-num">{layer.z}</td>
                <td className="lt-num">{rectLabel(layer)}</td>
              </tr>
            ))}
        </tbody>
      </table>
    </Card>
  );
}

function rectLabel(layer: Layer): string {
  const r = layer.placement.default;
  return `x ${r.x.toFixed(2)} y ${r.y.toFixed(2)} w ${r.w.toFixed(2)} h ${r.h.toFixed(2)}`;
}

/**
 * Applying a template rewrites placement and visibility on the layers a Moment already has.
 * It never deletes one, and it never touches device choices, words or sound.
 */
function applyTemplate(moment: MomentType, rect: NormalizedRect | null): void {
  const store = useAppStore.getState();
  const layers = moment.layers.map((layer) => {
    if (layer.kind !== 'camera') return layer;
    if (rect === null) return { ...layer, visible: false };
    return {
      ...layer,
      visible: true,
      placement: { ...layer.placement, default: rect },
    };
  });
  store.upsertMoment({ ...moment, layers });
}

function setSystemAudio(moment: MomentType, on: boolean): void {
  useAppStore.getState().upsertMoment({ ...moment, audio: { ...moment.audio, systemAudio: on } });
}

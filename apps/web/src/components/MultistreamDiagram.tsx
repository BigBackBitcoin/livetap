import type { ReactElement } from 'react';

/**
 * How multistreaming actually works, as one diagram: one production, three shapes, many
 * destinations. Inline SVG with `role="img"`, a full `aria-label`, and a visually hidden
 * ordered list of the stages so a screen-reader user gets the same three facts in the same
 * order (PRODUCT_SPEC §5a accessibility notes).
 *
 * No marketing arrows: the only lines here are the ones that exist in the code path.
 */
export function MultistreamDiagram(): ReactElement {
  return (
    <figure className="lt-diagram">
      <svg
        viewBox="0 0 720 260"
        className="lt-diagram__svg"
        role="img"
        aria-label="Your camera and screen go into LIVETAP. LIVETAP composes your Moment and encodes it once per shape — widescreen, vertical and square. Then it opens a separate connection to each destination you picked."
      >
        <defs>
          <marker id="lt-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0 0 L8 4 L0 8 z" fill="currentColor" />
          </marker>
        </defs>

        {/* Stage 1 — capture */}
        <g className="lt-diagram__stage">
          <rect x="8" y="94" width="150" height="72" rx="12" />
          <text x="83" y="124" textAnchor="middle" className="lt-diagram__title">
            Your camera
          </text>
          <text x="83" y="146" textAnchor="middle" className="lt-diagram__sub">
            and your screen
          </text>
        </g>

        <line x1="162" y1="130" x2="210" y2="130" markerEnd="url(#lt-arrow)" className="lt-diagram__link" />

        {/* Stage 2 — one production, encoded once per shape */}
        <g className="lt-diagram__stage lt-diagram__stage--core">
          <rect x="214" y="78" width="164" height="104" rx="12" />
          <text x="296" y="112" textAnchor="middle" className="lt-diagram__title">
            LIVETAP
          </text>
          <text x="296" y="134" textAnchor="middle" className="lt-diagram__sub">
            One production,
          </text>
          <text x="296" y="152" textAnchor="middle" className="lt-diagram__sub">
            made once on your machine
          </text>
        </g>

        {/* Stage 3 — three shapes */}
        {[
          { y: 34, label: '16:9' },
          { y: 112, label: '9:16' },
          { y: 190, label: '1:1' },
        ].map((row) => (
          <g key={row.label}>
            <line
              x1="382"
              y1="130"
              x2="436"
              y2={row.y + 18}
              markerEnd="url(#lt-arrow)"
              className="lt-diagram__link"
            />
            <g className="lt-diagram__shape">
              <rect x="440" y={row.y} width="70" height="36" rx="8" />
              <text x="475" y={row.y + 24} textAnchor="middle" className="lt-diagram__sub">
                {row.label}
              </text>
            </g>
          </g>
        ))}

        {/* Stage 4 — destinations, one separate connection each */}
        {[
          { y: 34, from: 34, label: 'YouTube' },
          { y: 78, from: 34, label: 'Twitch' },
          { y: 122, from: 112, label: 'TikTok' },
          { y: 166, from: 112, label: 'Instagram' },
          { y: 210, from: 190, label: 'Anywhere else' },
        ].map((row) => (
          <g key={row.label}>
            <line
              x1="514"
              y1={row.from + 18}
              x2="562"
              y2={row.y + 16}
              markerEnd="url(#lt-arrow)"
              className="lt-diagram__link"
            />
            <g className="lt-diagram__dest">
              <rect x="566" y={row.y} width="146" height="32" rx="8" />
              <text x="580" y={row.y + 21} className="lt-diagram__sub">
                {row.label}
              </text>
            </g>
          </g>
        ))}
      </svg>

      <ol className="lt-sr-only">
        <li>Your camera and your screen go into LIVETAP.</li>
        <li>LIVETAP composes your Moment and makes the picture once for each shape you need.</li>
        <li>It opens a separate connection to each destination you picked and sends to all of them.</li>
      </ol>

      <figcaption className="lt-diagram__caption">
        Made once on your machine. Sent straight to each platform. No relay in the middle to fail —
        so one platform having a bad night does not touch the others.
      </figcaption>
    </figure>
  );
}

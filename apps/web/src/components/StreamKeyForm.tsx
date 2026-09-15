import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { Button, Select, TextField } from '@livetap/ui';
import {
  PASTE_KEY_LOCATIONS,
  PLATFORM_PROFILES,
  pasteIngestDefault,
  resolveIngest,
  splitCombinedIngest,
} from '@livetap/adapters';
import { validateIngest } from '@livetap/core';
import type { AspectRatio, PlatformId } from '@livetap/core';

/**
 * The paste-a-key flow (PRODUCT_SPEC §5d, §6).
 *
 * This is the one place in the product that uses the platform's own vocabulary, because the
 * user is copying two labelled fields off the platform's own page and has to recognise them.
 * `stream key` is explicitly permitted by PRODUCT_SPEC §6.2 for exactly that reason, and the
 * server-address error has to name the scheme or it cannot be acted on.
 *
 * What it is NOT allowed to do is explain. §6 is blunt about it: paste the stream key, then
 * connect, nothing else — no essay, no lecture on what any of this is. So the form carries one
 * line of help, and that line says WHERE the value is on the creator's own screen, not what it
 * is. Everything else that used to be printed here is either pre-filled (the server address, the
 * name, the shape) or folded into a disclosure that is closed until somebody asks.
 *
 * When the platform is known, the address is pre-filled from `PASTE_INGEST_DEFAULTS` — and for
 * Twitch, whose ingest is regional, from Twitch's own published ingest list. It stays editable
 * and is labelled as a default, because the creator's own page is the authority: a pre-filled
 * address that cannot be overwritten is a guess with no way out of it.
 *
 * The key is `type="password"`, is never echoed back after saving, and never leaves this form
 * for anywhere except `secrets.ts`.
 */
export interface StreamKeySubmission {
  label: string;
  url: string;
  streamKey: string;
  aspect: AspectRatio;
}

const ALL_SHAPES: Array<{ value: AspectRatio; label: string }> = [
  { value: '16:9', label: 'Widescreen 16:9' },
  { value: '9:16', label: 'Vertical 9:16' },
  { value: '1:1', label: 'Square 1:1' },
];

export function StreamKeyForm({
  platform,
  onSubmit,
  onCancel,
  busy,
}: {
  /** The platform the creator tapped, when they tapped one. Absent for "Other". */
  platform?: PlatformId;
  onSubmit: (value: StreamKeySubmission) => void | Promise<void>;
  onCancel?: () => void;
  busy?: boolean;
}): ReactElement {
  const profile = platform ? PLATFORM_PROFILES[platform] : undefined;
  const shapes = profile
    ? ALL_SHAPES.filter((shape) => profile.supportedAspectRatios.includes(shape.value))
    : ALL_SHAPES;

  const [label, setLabel] = useState(profile?.displayName ?? '');
  const [url, setUrl] = useState(pasteIngestDefault(platform)?.url ?? '');
  const [streamKey, setStreamKey] = useState('');
  const [aspect, setAspect] = useState<AspectRatio>(profile?.preferredAspectRatio ?? '16:9');
  const [urlError, setUrlError] = useState<string | undefined>(undefined);
  const [keyError, setKeyError] = useState<string | undefined>(undefined);
  const [labelError, setLabelError] = useState<string | undefined>(undefined);
  const [tidied, setTidied] = useState<string | undefined>(undefined);

  /*
   * Twitch's ingest host is regional, so there is no single address to hard-code. Twitch
   * publishes the list itself, unauthenticated, and `resolveIngest` already reads it for the
   * signed-in path. A failed lookup leaves the field empty on purpose: `resolveIngest` falls
   * back to a host the official docs never name, and a wrong default fails at go-live for a
   * reason nobody can see, while an empty field asks a question the creator can answer off the
   * page already open in front of them.
   */
  useEffect(() => {
    let live = true;
    const doFetch = (globalThis as { fetch?: typeof fetch }).fetch;
    if (platform === 'twitch' && doFetch) {
      void resolveIngest(doFetch).then((resolved) => {
        if (!live || resolved.technical !== undefined) return;
        setUrl((current) => (current.trim().length === 0 ? resolved.url : current));
      });
    }
    return () => {
      live = false;
    };
  }, [platform]);

  /*
   * Some platforms print one joined address ending in the key, and some creators paste a joined
   * address into whichever field their eye landed on. Both are the same two values, so both are
   * accepted — and the form says what it did, because a field that silently rewrites itself is
   * worse than one that refuses.
   */
  const tidy = (): { url: string; streamKey: string } => {
    const pasted = splitCombinedIngest(url, streamKey);
    if (pasted.url !== url) setUrl(pasted.url);
    if (pasted.streamKey !== streamKey) setStreamKey(pasted.streamKey);
    setTidied(
      pasted.moved
        ? 'That was the whole address, so LIVETAP put it in the address box and took the key off the end.'
        : pasted.split
          ? 'That address had the key on the end, so LIVETAP separated the two.'
          : undefined,
    );
    return { url: pasted.url, streamKey: pasted.streamKey };
  };

  return (
    <form
      className="lt-keyform"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        const pasted = tidy();
        const nextLabelError = labelProblem(label);
        const nextUrlError = urlProblem(pasted.url);
        const nextKeyError = keyProblem(pasted.streamKey);
        setLabelError(nextLabelError);
        setUrlError(nextUrlError);
        setKeyError(nextKeyError);
        if (nextLabelError ?? nextUrlError ?? nextKeyError) return;
        void onSubmit({
          label: label.trim(),
          url: pasted.url,
          streamKey: pasted.streamKey,
          aspect,
        });
      }}
    >
      <TextField
        label="Stream key"
        type="password"
        hint={PASTE_KEY_LOCATIONS[platform ?? 'custom']}
        value={streamKey}
        autoComplete="off"
        spellCheck={false}
        error={keyError}
        onChange={(event) => setStreamKey(event.currentTarget.value)}
        onBlur={() => {
          const pasted = tidy();
          setKeyError(keyProblem(pasted.streamKey));
        }}
      />

      <TextField
        label={profile ? `Server address (${profile.displayName}'s usual one)` : 'Server address'}
        mono
        value={url}
        spellCheck={false}
        autoComplete="off"
        placeholder="rtmp://"
        error={urlError}
        onChange={(event) => setUrl(event.currentTarget.value)}
        onBlur={() => setUrlError(urlProblem(url))}
      />

      {tidied ? <p className="lt-keyform__lede">{tidied}</p> : null}

      <TextField
        label="Name for this destination"
        value={label}
        spellCheck={false}
        error={labelError}
        onChange={(event) => setLabel(event.currentTarget.value)}
        onBlur={() => setLabelError(labelProblem(label))}
      />

      {shapes.length > 1 ? (
        <Select
          label="Shape"
          value={aspect}
          onChange={(event) => setAspect(event.currentTarget.value as AspectRatio)}
          options={shapes}
        />
      ) : null}

      {/*
        Closed until somebody asks. §6 forbids the paragraph, not the answer: a creator who
        already knows where their key is never reads a word of this, and one who does not can
        open it without leaving the form.
      */}
      <details>
        <summary>Where do I find this?</summary>
        <p className="lt-keyform__lede">
          {profile
            ? `${profile.displayName} shows a server address and a stream key side by side. Copy both — the address is usually the one already filled in above.`
            : 'Your server shows an address and a key side by side. Copy both.'}
        </p>
        <p className="lt-keyform__lede">
          LIVETAP keeps the key on this device, for this destination, and never shows it again.
        </p>
      </details>

      <div className="lt-keyform__actions">
        {onCancel ? (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
        <Button type="submit" variant="primary" loading={busy}>
          Connect
        </Button>
      </div>
    </form>
  );
}

/**
 * The name is required, and it is required here rather than fixed up afterwards.
 *
 * An empty name used to fall through to the platform profile's display name, so a destination
 * the user had just described to themselves came back called "Custom" and every later mention
 * of it — the chip, the card, the remove confirmation, the pre-flight item — named something
 * they had never typed (PRODUCT_REVIEW P2-15). A silent default is worse than a question.
 *
 * When the creator tapped a platform the field arrives pre-filled with that platform's name, so
 * this asks nothing of them; it still refuses an empty one, because clearing it is a choice.
 */
export function labelProblem(value: string): string | undefined {
  if (value.trim().length === 0) {
    return 'Give this destination a name, so you can recognise it in Studio.';
  }
  return undefined;
}

/**
 * Field-level, specific, and actionable. "Invalid URL" is the string this whole product is
 * designed against.
 */
export function urlProblem(value: string): string | undefined {
  const url = value.trim();
  if (url.length === 0) return 'A server address is required. The platform shows it next to your stream key.';
  if (/^https?:\/\//i.test(url)) {
    return 'That looks like a web page address, not a stream server. Stream servers start with rtmp:// or rtmps://.';
  }
  const result = validateIngest({
    protocol: url.toLowerCase().startsWith('rtmps:') ? 'rtmps' : 'rtmp',
    url,
    streamKey: 'placeholder',
  });
  if (!result.ok) {
    const [first] = result.errors;
    return first ?? 'That server address is not one LIVETAP can send to.';
  }
  return undefined;
}

export function keyProblem(value: string): string | undefined {
  if (value.trim().length === 0) return 'A stream key is required. Copy it from the platform’s live dashboard.';
  if (/\s/.test(value)) return 'That key has a space in it. Copy it again — keys never contain spaces.';
  return undefined;
}

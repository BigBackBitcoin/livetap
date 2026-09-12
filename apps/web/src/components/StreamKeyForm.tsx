import { useState } from 'react';
import type { ReactElement } from 'react';
import { Button, Select, TextField } from '@livetap/ui';
import { validateIngest } from '@livetap/core';
import type { AspectRatio } from '@livetap/core';

/**
 * The paste-a-key flow (PRODUCT_SPEC §5d).
 *
 * This is the one place in the product that uses the platform's own vocabulary, because the
 * user is copying two labelled fields off the platform's own page and has to recognise them.
 * `stream key` is explicitly permitted by PRODUCT_SPEC §6.2 for exactly that reason, and the
 * server-address error has to name the scheme or it cannot be acted on.
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

export function StreamKeyForm({
  onSubmit,
  onCancel,
  busy,
}: {
  onSubmit: (value: StreamKeySubmission) => void | Promise<void>;
  onCancel?: () => void;
  busy?: boolean;
}): ReactElement {
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  const [streamKey, setStreamKey] = useState('');
  const [aspect, setAspect] = useState<AspectRatio>('16:9');
  const [urlError, setUrlError] = useState<string | undefined>(undefined);
  const [keyError, setKeyError] = useState<string | undefined>(undefined);
  const [labelError, setLabelError] = useState<string | undefined>(undefined);

  const check = (): boolean => {
    const nextLabelError = labelProblem(label);
    const nextUrlError = urlProblem(url);
    const nextKeyError = keyProblem(streamKey);
    setLabelError(nextLabelError);
    setUrlError(nextUrlError);
    setKeyError(nextKeyError);
    return (
      nextLabelError === undefined && nextUrlError === undefined && nextKeyError === undefined
    );
  };

  return (
    <form
      className="lt-keyform"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (!check()) return;
        void onSubmit({ label: label.trim(), url: url.trim(), streamKey, aspect });
      }}
    >
      <p className="lt-keyform__lede">
        Open the platform&rsquo;s live dashboard and copy the two things it shows you: a server
        address and a stream key.
      </p>

      <TextField
        label="Name for this destination"
        hint="Anything you will recognise in Studio, like “Late night build”."
        value={label}
        spellCheck={false}
        error={labelError}
        onChange={(event) => setLabel(event.currentTarget.value)}
        onBlur={() => setLabelError(labelProblem(label))}
      />

      <TextField
        label="Server address"
        hint="The platform calls this the server or the URL."
        value={url}
        spellCheck={false}
        autoComplete="off"
        error={urlError}
        onChange={(event) => setUrl(event.currentTarget.value)}
        onBlur={() => setUrlError(urlProblem(url))}
      />

      <TextField
        label="Stream key"
        type="password"
        hint="This is a password for your channel. LIVETAP keeps it for this session only and never shows it again."
        value={streamKey}
        autoComplete="off"
        spellCheck={false}
        error={keyError}
        onChange={(event) => setStreamKey(event.currentTarget.value)}
        onBlur={() => setKeyError(keyProblem(streamKey))}
      />

      <Select
        label="Shape"
        hint="LIVETAP sends this destination the shape you pick here."
        value={aspect}
        onChange={(event) => setAspect(event.currentTarget.value as AspectRatio)}
        options={[
          { value: '16:9', label: 'Widescreen 16:9' },
          { value: '9:16', label: 'Vertical 9:16' },
          { value: '1:1', label: 'Square 1:1' },
        ]}
      />

      <div className="lt-keyform__actions">
        {onCancel ? (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
        <Button type="submit" variant="primary" loading={busy}>
          Save this destination
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

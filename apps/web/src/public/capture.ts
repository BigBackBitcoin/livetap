/**
 * The "get notified" conversion path.
 *
 * There is no LIVETAP account and no database behind this page, so this form only exists when
 * the deployment owner has configured somewhere for a signup to go (`GET /api/early-access`
 * reports that). When it has not, `mountCapture` renders nothing and the page's own GitHub
 * "Watch releases" link stands in as the fallback. Plain DOM, no framework, no dependencies, so
 * it can load with the rest of the static marketing page.
 */

const PLATFORM_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'mac', label: 'Mac' },
  { value: 'windows', label: 'Windows' },
  { value: 'ios', label: 'iPhone' },
  { value: 'android', label: 'Android' },
  { value: 'web', label: 'Web' },
];

const CONSENT_TEXT =
  'Email me once when a LIVETAP desktop or mobile build ships. Nothing else. One click unsubscribes.';

interface EarlyAccessConfig {
  enabled: boolean;
  method: 'webhook' | 'none';
}

function isEarlyAccessConfig(value: unknown): value is EarlyAccessConfig {
  return Boolean(value) && typeof value === 'object' && typeof (value as { enabled?: unknown }).enabled === 'boolean';
}

async function fetchConfig(): Promise<EarlyAccessConfig> {
  try {
    const res = await fetch('/api/early-access', { method: 'GET', headers: { Accept: 'application/json' } });
    if (!res.ok) return { enabled: false, method: 'none' };
    const data: unknown = await res.json();
    return isEarlyAccessConfig(data) ? data : { enabled: false, method: 'none' };
  } catch {
    return { enabled: false, method: 'none' };
  }
}

function errorCopy(status: number): string {
  if (status === 400) return 'That email does not look right. Check it and try again.';
  if (status === 429) return 'Too many requests from this connection. Wait a few minutes and try again.';
  if (status === 502) return 'The notification service is not responding. Try again shortly.';
  if (status === 503) return 'Notifications are not set up on this deployment yet.';
  return 'Something went wrong. Try again shortly.';
}

/** Builds the labelled field markup shared by TextField/Select in `packages/ui`. */
function buildField(labelText: string, control: HTMLElement, id: string): HTMLDivElement {
  const field = document.createElement('div');
  field.className = 'lt-field';
  const label = document.createElement('label');
  label.className = 'lt-field__label';
  label.setAttribute('for', id);
  label.textContent = labelText;
  field.append(label, control);
  return field;
}

function buildForm(host: HTMLElement): void {
  const form = document.createElement('form');
  form.className = 'lt-early-access';
  form.noValidate = true;

  const emailInput = document.createElement('input');
  emailInput.className = 'lt-input';
  emailInput.id = 'lt-early-access-email';
  emailInput.name = 'email';
  emailInput.type = 'email';
  emailInput.required = true;
  emailInput.autocomplete = 'email';
  emailInput.maxLength = 254;
  form.appendChild(buildField('Email', emailInput, emailInput.id));

  const platformSelect = document.createElement('select');
  platformSelect.className = 'lt-input';
  platformSelect.id = 'lt-early-access-platform';
  platformSelect.name = 'platform';
  for (const option of PLATFORM_OPTIONS) {
    const opt = document.createElement('option');
    opt.value = option.value;
    opt.textContent = option.label;
    platformSelect.appendChild(opt);
  }
  form.appendChild(buildField('Platform', platformSelect, platformSelect.id));

  const consentField = document.createElement('div');
  consentField.className = 'lt-field';
  const consentLabel = document.createElement('label');
  consentLabel.className = 'lt-field__label';
  const consentInput = document.createElement('input');
  consentInput.type = 'checkbox';
  consentInput.id = 'lt-early-access-consent';
  consentInput.name = 'consent';
  consentInput.required = true;
  const consentText = document.createElement('span');
  consentText.textContent = CONSENT_TEXT;
  consentLabel.append(consentInput, consentText);
  consentField.appendChild(consentLabel);
  form.appendChild(consentField);

  const errorEl = document.createElement('p');
  errorEl.className = 'lt-field__error';
  errorEl.setAttribute('role', 'alert');
  errorEl.hidden = true;
  form.appendChild(errorEl);

  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'lt-btn lt-btn--primary lt-btn--md';
  submit.textContent = 'Notify me';
  form.appendChild(submit);

  const showError = (message: string): void => {
    errorEl.textContent = message;
    errorEl.hidden = false;
  };
  const clearError = (): void => {
    errorEl.hidden = true;
    errorEl.textContent = '';
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    clearError();

    if (!consentInput.checked) {
      showError('Check the box so we know it is okay to email you.');
      return;
    }

    submit.disabled = true;
    const email = emailInput.value.trim();
    const platform = platformSelect.value;

    fetch('/api/early-access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, consent: true, platform }),
    })
      .then((res) => {
        if (res.status === 202) {
          const done = document.createElement('p');
          done.className = 'lt-field__hint';
          done.setAttribute('role', 'status');
          done.textContent = 'Done. One email, when it ships.';
          host.replaceChildren(done);
          return;
        }
        showError(errorCopy(res.status));
        submit.disabled = false;
      })
      .catch(() => {
        showError(errorCopy(0));
        submit.disabled = false;
      });
  });

  host.replaceChildren(form);
}

/**
 * Mounts the early-access form into `host` only when this deployment has a notification
 * endpoint configured. If it does not, `host` is left untouched so the page's existing GitHub
 * "Watch releases" link is the only call to action.
 */
export async function mountCapture(host: HTMLElement): Promise<void> {
  const config = await fetchConfig();
  if (!config.enabled) return;
  buildForm(host);
}

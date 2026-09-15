import { useCallback, useEffect, useState } from 'react';

export interface DeviceOption {
  deviceId: string;
  label: string;
}

export interface Devices {
  cameras: DeviceOption[];
  microphones: DeviceOption[];
  /** Enumeration has finished at least once. */
  probed: boolean;
  /** The browser has no device API at all (an insecure origin, a headless runner, SSR). */
  unsupported: boolean;
  /**
   * Whether this page may actually USE the devices it can see.
   *
   * `enumerateDevices` answers a different question from "can I open this camera". With the
   * permission blocked it still returns an entry per device, with no label and no id — so a list
   * built from it reads "Camera 1", "Microphone 1", which is the app telling the creator it has a
   * camera it cannot open. That is the one place a product built on never claiming what it cannot
   * do was claiming something untrue, and it was found by blocking the permission and looking.
   *
   * `denied` means the OS or the browser has refused. `prompt` means nobody has asked yet, which
   * is LIVETAP's normal resting state: it deliberately never calls getUserMedia on mount.
   */
  permission: 'granted' | 'prompt' | 'denied' | 'unknown';
  refresh(): Promise<void>;
}

interface DeviceInfoLike {
  kind: string;
  deviceId: string;
  label?: string;
}

interface MediaDevicesLike {
  enumerateDevices?: () => Promise<DeviceInfoLike[]>;
  addEventListener?: (type: string, listener: () => void) => void;
  removeEventListener?: (type: string, listener: () => void) => void;
}

function mediaDevices(): MediaDevicesLike | undefined {
  return (globalThis as { navigator?: { mediaDevices?: MediaDevicesLike } }).navigator?.mediaDevices;
}

/**
 * Device enumeration, honestly.
 *
 * LIVETAP never calls `getUserMedia` on mount, so the OS prompt is never a surprise
 * (PRODUCT_SPEC §5b). That means labels are empty until permission is granted, and we say
 * "Camera 1" rather than inventing a model name. A test runner or an insecure origin has no
 * device API at all, and that is a first-class state — not an error.
 */
export function useDevices(): Devices {
  const [cameras, setCameras] = useState<DeviceOption[]>([]);
  const [microphones, setMicrophones] = useState<DeviceOption[]>([]);
  const [probed, setProbed] = useState(false);
  const [permission, setPermission] = useState<Devices['permission']>('unknown');
  const unsupported = typeof mediaDevices()?.enumerateDevices !== 'function';

  const refresh = useCallback(async (): Promise<void> => {
    const api = mediaDevices();
    if (typeof api?.enumerateDevices !== 'function') {
      setProbed(true);
      return;
    }
    try {
      const all = await api.enumerateDevices();
      setCameras(pick(all, 'videoinput', 'Camera'));
      setMicrophones(pick(all, 'audioinput', 'Microphone'));
      setPermission(await readPermission(all));
    } catch {
      setCameras([]);
      setMicrophones([]);
    } finally {
      setProbed(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const api = mediaDevices();
    if (!api?.addEventListener) return undefined;
    const onChange = (): void => void refresh();
    api.addEventListener('devicechange', onChange);
    return () => api.removeEventListener?.('devicechange', onChange);
  }, [refresh]);

  return { cameras, microphones, probed, unsupported, permission, refresh };
}

function pick(all: DeviceInfoLike[], kind: string, fallback: string): DeviceOption[] {
  return all
    .filter((d) => d.kind === kind)
    .map((d, index) => ({
      deviceId: d.deviceId || `${kind}-${index}`,
      label: d.label && d.label.length > 0 ? d.label : `${fallback} ${index + 1}`,
    }));
}

/**
 * Are these devices usable, or only visible?
 *
 * The Permissions API is the direct answer and Chromium has it for `camera`; Safari does not, so
 * there is a fallback. A device list whose entries have neither a label nor an id is what a
 * browser returns when it has not been granted access — that is either "not asked yet" or
 * "refused", and `permissions.query` is what separates them when it exists.
 */
async function readPermission(all: DeviceInfoLike[]): Promise<Devices['permission']> {
  const media = all.filter((d) => d.kind === 'videoinput' || d.kind === 'audioinput');
  const identified = media.some((d) => (d.label ?? '') !== '' || d.deviceId !== '');
  if (media.length > 0 && identified) return 'granted';

  const permissions = (globalThis as { navigator?: { permissions?: { query?: (d: { name: string }) => Promise<{ state: string }> } } })
    .navigator?.permissions;
  if (typeof permissions?.query !== 'function') return media.length > 0 ? 'prompt' : 'unknown';
  try {
    const status = await permissions.query({ name: 'camera' });
    if (status.state === 'denied') return 'denied';
    if (status.state === 'granted') return 'granted';
    return 'prompt';
  } catch {
    // Firefox throws on an unknown descriptor name rather than rejecting the query.
    return media.length > 0 ? 'prompt' : 'unknown';
  }
}

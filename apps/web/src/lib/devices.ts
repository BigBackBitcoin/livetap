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

  return { cameras, microphones, probed, unsupported, refresh };
}

function pick(all: DeviceInfoLike[], kind: string, fallback: string): DeviceOption[] {
  return all
    .filter((d) => d.kind === kind)
    .map((d, index) => ({
      deviceId: d.deviceId || `${kind}-${index}`,
      label: d.label && d.label.length > 0 ? d.label : `${fallback} ${index + 1}`,
    }));
}

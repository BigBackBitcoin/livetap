/**
 * The closed LIVETAP icon set: 24 glyphs, 24x24 grid, 1.75px stroke, currentColor.
 * Adding a 25th requires naming the one it replaces. See DESIGN_SYSTEM.md §7.
 *
 * Icons are decorative by default (`aria-hidden`). Pass `title` only when the icon
 * is the sole content of a non-interactive element; interactive icon-only controls
 * must use `IconButton`, which carries the accessible name.
 */

import type { ReactElement, ReactNode, SVGProps } from 'react';

export type IconSize = 20 | 24;

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'children' | 'width' | 'height'> {
  /** 20px inline with text, 24px for controls and nav. Strokes are not rescaled. */
  size?: IconSize;
  /** When set, the icon becomes `role="img"` with this accessible name. */
  title?: string;
}

export type IconComponent = (props: IconProps) => ReactElement;

function makeIcon(name: string, children: ReactNode): IconComponent {
  function Icon({ size = 24, title, className, ...rest }: IconProps): ReactElement {
    const classes = ['lt-icon', className].filter(Boolean).join(' ');
    return (
      <svg
        viewBox="0 0 24 24"
        width={size}
        height={size}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={classes}
        role={title ? 'img' : undefined}
        aria-hidden={title ? undefined : true}
        focusable={false}
        {...rest}
      >
        {title ? <title>{title}</title> : null}
        {children}
      </svg>
    );
  }
  Icon.displayName = `Icon.${name}`;
  return Icon;
}

export const CameraIcon = makeIcon(
  'camera',
  <>
    <path d="M2.75 7.75a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2Z" />
    <path d="m14.75 10.5 5.5-3.25v9.5l-5.5-3.25Z" />
  </>,
);

export const MicIcon = makeIcon(
  'mic',
  <>
    <path d="M12 3.75a3 3 0 0 1 3 3v4.5a3 3 0 0 1-6 0v-4.5a3 3 0 0 1 3-3Z" />
    <path d="M5.75 11.5a6.25 6.25 0 0 0 12.5 0" />
    <path d="M12 17.75v2.5" />
    <path d="M9 20.25h6" />
  </>,
);

export const MicOffIcon = makeIcon(
  'mic-off',
  <>
    <path d="M15 7.5v-.75a3 3 0 0 0-5.66-1.4" />
    <path d="M9 10.5v1.25a3 3 0 0 0 4.9 2.32" />
    <path d="M5.75 11.5a6.25 6.25 0 0 0 9.6 5.27" />
    <path d="M18.25 11.5v.25" />
    <path d="M12 17.75v2.5" />
    <path d="M9 20.25h6" />
    <path d="M3.75 3.75 20.25 20.25" />
  </>,
);

export const ScreenIcon = makeIcon(
  'screen',
  <>
    <path d="M3.25 5.75a1.5 1.5 0 0 1 1.5-1.5h14.5a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5H4.75a1.5 1.5 0 0 1-1.5-1.5Z" />
    <path d="M12 16.25v3.5" />
    <path d="M9 19.75h6" />
  </>,
);

export const SettingsIcon = makeIcon(
  'settings',
  <>
    <circle cx="12" cy="12" r="3.25" />
    <path d="M12 8.75v-2.5M12 17.75v-2.5M15.75 12h2.5M5.75 12h2.5" />
    <path d="m14.65 9.35 1.75-1.75M7.6 16.4l1.75-1.75M14.65 14.65l1.75 1.75M7.6 7.6l1.75 1.75" />
  </>,
);

export const ChatIcon = makeIcon(
  'chat',
  <path d="M19.25 13a1.75 1.75 0 0 1-1.75 1.75H9.25L5 18.25V6.5A1.75 1.75 0 0 1 6.75 4.75h10.75A1.75 1.75 0 0 1 19.25 6.5Z" />,
);

export const ChartIcon = makeIcon(
  'chart',
  <>
    <path d="M3.75 19.5h16.5" />
    <path d="M6.5 16.75V13M11 16.75V8.5M15.5 16.75v-5M20 16.75V5.5" />
  </>,
);

export const PlusIcon = makeIcon('plus', <path d="M12 5.75v12.5M5.75 12h12.5" />);

export const XIcon = makeIcon('x', <path d="m6.25 6.25 11.5 11.5M17.75 6.25 6.25 17.75" />);

export const CheckIcon = makeIcon('check', <path d="m5.25 12.5 4.5 4.5 9-9.5" />);

export const AlertIcon = makeIcon(
  'alert',
  <>
    <path d="M12 4.75 20.5 19.25H3.5Z" />
    <path d="M12 10v3.75" />
    <path d="M12 16.5h.01" />
  </>,
);

export const ExternalLinkIcon = makeIcon(
  'external-link',
  <>
    <path d="M14 4.75h5.25V10" />
    <path d="M19.25 4.75 11.5 12.5" />
    <path d="M18 14.5v3.75a1.5 1.5 0 0 1-1.5 1.5H5.75a1.5 1.5 0 0 1-1.5-1.5V7.5A1.5 1.5 0 0 1 5.75 6H9.5" />
  </>,
);

export const PlayIcon = makeIcon('play', <path d="M8.25 5.5 18.75 12 8.25 18.5Z" />);

export const StopIcon = makeIcon(
  'stop',
  <path d="M6.75 7.75a1 1 0 0 1 1-1h8.5a1 1 0 0 1 1 1v8.5a1 1 0 0 1-1 1h-8.5a1 1 0 0 1-1-1Z" />,
);

export const RefreshIcon = makeIcon(
  'refresh',
  <>
    <path d="M19.25 12a7.25 7.25 0 1 1-2.4-5.4" />
    <path d="M19.25 4.75V9.5h-4.75" />
  </>,
);

export const ChevronIcon = makeIcon('chevron', <path d="m6.5 9.75 5.5 5.5 5.5-5.5" />);

export const SunIcon = makeIcon(
  'sun',
  <>
    <circle cx="12" cy="12" r="3.75" />
    <path d="M12 3.75v1.5M12 18.75v1.5M3.75 12h1.5M18.75 12h1.5" />
    <path d="m6.4 6.4 1.05 1.05M16.55 16.55l1.05 1.05M17.6 6.4l-1.05 1.05M7.45 16.55 6.4 17.6" />
  </>,
);

export const MoonIcon = makeIcon(
  'moon',
  <path d="M20 14.5A8.25 8.25 0 0 1 9.5 4a8.25 8.25 0 1 0 10.5 10.5Z" />,
);

export const SlidersIcon = makeIcon(
  'sliders',
  <>
    <path d="M4.25 7.5h15.5M4.25 12h15.5M4.25 16.5h15.5" />
    <circle cx="9" cy="7.5" r="1.75" />
    <circle cx="15" cy="12" r="1.75" />
    <circle cx="7.5" cy="16.5" r="1.75" />
  </>,
);

export const RecordIcon = makeIcon(
  'record',
  <>
    <circle cx="12" cy="12" r="7.75" />
    <circle cx="12" cy="12" r="3.5" fill="currentColor" stroke="none" />
  </>,
);

export const UsersIcon = makeIcon(
  'users',
  <>
    <circle cx="10.25" cy="8" r="3.25" />
    <path d="M15.75 19.25v-1.5a3.5 3.5 0 0 0-3.5-3.5h-4a3.5 3.5 0 0 0-3.5 3.5v1.5" />
    <path d="M16.75 5.2a3.25 3.25 0 0 1 0 5.6" />
    <path d="M19.75 19.25v-1.5a3.5 3.5 0 0 0-2.6-3.38" />
  </>,
);

export const TvIcon = makeIcon(
  'tv',
  <>
    <path d="M3.75 8.5a1.75 1.75 0 0 1 1.75-1.75h13A1.75 1.75 0 0 1 20.25 8.5v8a1.75 1.75 0 0 1-1.75 1.75h-13A1.75 1.75 0 0 1 3.75 16.5Z" />
    <path d="m8.5 3.75 3.5 3 3.5-3" />
  </>,
);

export const GlobeIcon = makeIcon(
  'globe',
  <>
    <circle cx="12" cy="12" r="8.25" />
    <path d="M3.75 12h16.5" />
    <path d="M12 3.75c2.5 2.6 2.5 13.9 0 16.5-2.5-2.6-2.5-13.9 0-16.5Z" />
  </>,
);

export const SpinnerIcon = makeIcon('spinner', <path d="M12 3.75a8.25 8.25 0 1 0 8.25 8.25" />);

/** Lookup table, for code that picks an icon by name (e.g. a Moment's `icon` key). */
export const Icons = {
  camera: CameraIcon,
  mic: MicIcon,
  'mic-off': MicOffIcon,
  screen: ScreenIcon,
  settings: SettingsIcon,
  chat: ChatIcon,
  chart: ChartIcon,
  plus: PlusIcon,
  x: XIcon,
  check: CheckIcon,
  alert: AlertIcon,
  'external-link': ExternalLinkIcon,
  play: PlayIcon,
  stop: StopIcon,
  refresh: RefreshIcon,
  chevron: ChevronIcon,
  sun: SunIcon,
  moon: MoonIcon,
  sliders: SlidersIcon,
  record: RecordIcon,
  users: UsersIcon,
  tv: TvIcon,
  globe: GlobeIcon,
  spinner: SpinnerIcon,
} as const satisfies Record<string, IconComponent>;

export type IconName = keyof typeof Icons;

export const ICON_NAMES = Object.keys(Icons) as IconName[];

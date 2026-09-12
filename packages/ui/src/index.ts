/**
 * @livetap/ui — the LIVETAP component library.
 *
 * Styles are a separate, explicit import (they are a side effect, not a module):
 *   import '@livetap/ui/styles.css';
 *
 * Normative spec: docs/design/DESIGN_SYSTEM.md
 */

/* Tokens ----------------------------------------------------------- */
export {
  fontFamily,
  typeScale,
  fontWeight,
  space,
  radius,
  duration,
  easing,
  breakpoint,
  mediaQuery,
  focusRing,
  touchTargetMin,
  darkPalette,
  lightPalette,
  palettes,
  THEME_STORAGE_KEY,
  stateVar,
  healthVar,
  HEALTH_HEADLINE,
  STATE_LABEL,
  PULSING_STATES,
} from './tokens.js';
export type { ThemeName, ThemePreference, ThemePalette, StatePalette } from './tokens.js';

/* Hooks ------------------------------------------------------------ */
export { useTheme } from './hooks/useTheme.js';
export type { UseThemeResult } from './hooks/useTheme.js';
export { useMediaQuery } from './hooks/useMediaQuery.js';
export { useReducedMotion } from './hooks/useReducedMotion.js';

/* Primitives ------------------------------------------------------- */
export { Button } from './components/Button.js';
export type { ButtonProps, ButtonVariant, ButtonSize } from './components/Button.js';

export { IconButton } from './components/IconButton.js';
export type { IconButtonProps, IconButtonVariant } from './components/IconButton.js';

export { Toggle } from './components/Toggle.js';
export type { ToggleProps } from './components/Toggle.js';

export { Select } from './components/Select.js';
export type { SelectProps, SelectOption } from './components/Select.js';

export { TextField } from './components/TextField.js';
export type { TextFieldProps } from './components/TextField.js';

export { Card } from './components/Card.js';
export type { CardProps } from './components/Card.js';

export { Sheet } from './components/Sheet.js';
export type { SheetProps } from './components/Sheet.js';

export { Tabs } from './components/Tabs.js';
export type { TabsProps, TabItem } from './components/Tabs.js';

export { Badge } from './components/Badge.js';
export type { BadgeProps, BadgeTone } from './components/Badge.js';

export { Kbd } from './components/Kbd.js';
export type { KbdProps } from './components/Kbd.js';

export { Spinner } from './components/Spinner.js';
export type { SpinnerProps } from './components/Spinner.js';

export { Tooltip } from './components/Tooltip.js';
export type { TooltipProps } from './components/Tooltip.js';

export { VisuallyHidden } from './components/VisuallyHidden.js';
export type { VisuallyHiddenProps } from './components/VisuallyHidden.js';

export { Banner } from './components/Banner.js';
export type { BannerProps, BannerTone } from './components/Banner.js';

export { Meter } from './components/Meter.js';
export type { MeterProps } from './components/Meter.js';

export { Logo } from './components/Logo.js';
export type { LogoProps, LogoVariant, LogoSize } from './components/Logo.js';

/* Domain components ------------------------------------------------ */
export { StatusChip, isPulsingState } from './components/StatusChip.js';
export type { StatusChipProps, DotTreatment } from './components/StatusChip.js';

export { HealthPill } from './components/HealthPill.js';
export type { HealthPillProps } from './components/HealthPill.js';

export { ErrorCard } from './components/ErrorCard.js';
export type { ErrorCardProps, ErrorCardAction } from './components/ErrorCard.js';

export { MomentCard } from './components/MomentCard.js';
export type { MomentCardProps } from './components/MomentCard.js';

export { GoLiveButton, formatElapsed } from './components/GoLiveButton.js';
export type { GoLiveButtonProps, GoLiveState } from './components/GoLiveButton.js';

/* Icons ------------------------------------------------------------ */
export {
  Icons,
  ICON_NAMES,
  CameraIcon,
  MicIcon,
  MicOffIcon,
  ScreenIcon,
  SettingsIcon,
  ChatIcon,
  ChartIcon,
  PlusIcon,
  XIcon,
  CheckIcon,
  AlertIcon,
  ExternalLinkIcon,
  PlayIcon,
  StopIcon,
  RefreshIcon,
  ChevronIcon,
  SunIcon,
  MoonIcon,
  SlidersIcon,
  RecordIcon,
  UsersIcon,
  TvIcon,
  GlobeIcon,
  SpinnerIcon,
} from './components/Icons.js';
export type { IconProps, IconName, IconSize, IconComponent } from './components/Icons.js';

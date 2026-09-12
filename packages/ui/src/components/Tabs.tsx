import { useId, useRef } from 'react';
import type { KeyboardEvent, ReactElement, ReactNode } from 'react';

export interface TabItem {
  id: string;
  label: string;
  /** Optional leading icon (20px in Pro density, 24px in Simple). */
  icon?: ReactNode;
  /** Small trailing count, e.g. unread chat messages. */
  badge?: ReactNode;
  content: ReactNode;
}

export interface TabsProps {
  tabs: readonly TabItem[];
  /** Controlled active tab id. */
  value: string;
  onValueChange: (id: string) => void;
  /** Accessible name for the tablist, e.g. "Studio dock". */
  label: string;
  className?: string;
}

/**
 * Roving-tabindex tabs: exactly one tab is in the tab order, arrows move between
 * them, `Home`/`End` jump to the ends. Used for the Studio dock
 * (Chat / Destinations / Health) and for Settings sections on tablet.
 */
export function Tabs({ tabs, value, onValueChange, label, className }: TabsProps): ReactElement {
  const baseId = useId();
  const listRef = useRef<HTMLDivElement | null>(null);
  const activeIndex = Math.max(
    0,
    tabs.findIndex((tab) => tab.id === value),
  );

  const move = (nextIndex: number): void => {
    const wrapped = ((nextIndex % tabs.length) + tabs.length) % tabs.length;
    const next = tabs[wrapped];
    if (!next) return;
    onValueChange(next.id);
    const buttons = listRef.current?.querySelectorAll<HTMLElement>('[role="tab"]');
    buttons?.item(wrapped)?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault();
        move(activeIndex + 1);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        move(activeIndex - 1);
        break;
      case 'Home':
        event.preventDefault();
        move(0);
        break;
      case 'End':
        event.preventDefault();
        move(tabs.length - 1);
        break;
      default:
        break;
    }
  };

  const active = tabs[activeIndex];

  return (
    <div className={['lt-tabs', className].filter(Boolean).join(' ')}>
      <div
        ref={listRef}
        className="lt-tablist"
        role="tablist"
        aria-label={label}
        onKeyDown={onKeyDown}
      >
        {tabs.map((tab) => {
          const selected = tab.id === active?.id;
          return (
            <button
              key={tab.id}
              type="button"
              id={`${baseId}-tab-${tab.id}`}
              className="lt-tab lt-touch"
              role="tab"
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => onValueChange(tab.id)}
            >
              {tab.icon}
              {tab.label}
              {tab.badge}
            </button>
          );
        })}
      </div>
      {active ? (
        <div
          className="lt-tabpanel"
          role="tabpanel"
          id={`${baseId}-panel-${active.id}`}
          aria-labelledby={`${baseId}-tab-${active.id}`}
          tabIndex={0}
        >
          {active.content}
        </div>
      ) : null}
    </div>
  );
}

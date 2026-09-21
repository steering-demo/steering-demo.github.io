import { useRef } from 'react';

export interface ScenarioTabsProps {
  scenarios: { id: string; title: string }[];
  activeId: string;
  onSelect: (id: string) => void;
  panelId: string;
}

/**
 * Tabs are generated from the data, so adding a scenario to `scenarios.md` adds a tab with no
 * component change. On narrow screens the strip scrolls horizontally inside its own box rather
 * than widening the page.
 */
export function ScenarioTabs({ scenarios, activeId, onSelect, panelId }: ScenarioTabsProps) {
  const buttons = useRef<Record<string, HTMLButtonElement | null>>({});
  const activeIndex = Math.max(
    0,
    scenarios.findIndex((scenario) => scenario.id === activeId),
  );

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const last = scenarios.length - 1;
    let next: number;
    switch (event.key) {
      case 'ArrowRight':
        next = activeIndex === last ? 0 : activeIndex + 1;
        break;
      case 'ArrowLeft':
        next = activeIndex === 0 ? last : activeIndex - 1;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = last;
        break;
      default:
        return;
    }
    event.preventDefault();
    const id = scenarios[next].id;
    onSelect(id);
    buttons.current[id]?.focus();
  }

  return (
    <div className="min-w-0">
      <div
        role="tablist"
        aria-label="Steering scenario"
        onKeyDown={handleKeyDown}
        className="tabs-scroll -mx-1 flex gap-1 overflow-x-auto px-1 py-1"
      >
        {scenarios.map((scenario) => {
          const selected = scenario.id === activeId;
          return (
            <button
              key={scenario.id}
              ref={(element) => {
                buttons.current[scenario.id] = element;
              }}
              type="button"
              role="tab"
              id={`tab-${scenario.id}`}
              aria-selected={selected}
              aria-controls={panelId}
              tabIndex={selected ? 0 : -1}
              onClick={() => onSelect(scenario.id)}
              className={`pressable shrink-0 whitespace-nowrap rounded-lg border px-3.5 py-2 text-sm ${
                selected
                  ? 'border-[var(--color-line-strong)] bg-[var(--color-surface-3)] font-medium text-[var(--color-ink)]'
                  : 'border-[var(--color-line)] bg-[var(--color-surface-1)] text-[var(--color-ink-2)] hover:border-[var(--color-line-strong)] hover:text-[var(--color-ink)]'
              }`}
            >
              {scenario.title}
            </button>
          );
        })}
      </div>
    </div>
  );
}

import { useState } from "react";
import { Input } from "../design/primitives/Input.js";
import { Sheet } from "../design/primitives/Sheet.js";
import { cn } from "../lib/cn.js";
import { rowButtonFocus } from "../lib/rowButtonFocus.js";

export interface EntityOption {
  id: string;
  label: string;
  sublabel?: string;
}

export interface EntityPickerProps {
  label: string;
  /** Recent-first — this component doesn't reorder what it's given. */
  options: EntityOption[];
  value: EntityOption | null;
  onChange: (option: EntityOption) => void;
  onAddNew?: () => void;
  addNewLabel?: string;
  /** GAP-129/GAP-125: when `options` is fed by a query still in flight (the common shape for an `enabled`-gated picker query that only starts fetching once this sheet opens), renders a loading notice in place of the otherwise-indistinguishable empty list. Callers with a static option list never pass this. */
  pending?: boolean;
}

/**
 * §6.3 `EntityPicker`: vehicle / driver / customer. Pre-filled by U-3,
 * opens a searchable sheet, recent-first, with "Add new" pinned at the
 * bottom. The search box filters client-side over the options it was
 * given — it does not fetch, so a long list is the caller's concern
 * (paginating or narrowing `options` before handing them to this
 * component).
 */
export function EntityPicker({
  label,
  options,
  value,
  onChange,
  onAddNew,
  addNewLabel = "Add new",
  pending = false,
}: EntityPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const filtered =
    query.trim() === ""
      ? options
      : options.filter((option) =>
          `${option.label} ${option.sublabel ?? ""}`.toLowerCase().includes(query.toLowerCase()),
        );

  return (
    <div className="flex flex-col gap-1">
      {/* Not a native <label htmlFor>: that association only works for
          form-associated elements, not a <button> — the visible label
          text is decorative, and the button's own aria-label (below)
          carries the field's context to assistive tech, since the
          button's visible text becomes just the chosen entity's name
          once a value is set. */}
      <span className="text-label font-medium text-ink-secondary">{label}</span>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={value !== null ? `${label}: ${value.label}` : `Choose ${label.toLowerCase()}`}
        className="min-h-tap w-full rounded-sm border border-transparent bg-surface-sunken px-3 text-left text-body text-ink-primary"
      >
        {value !== null ? (
          value.label
        ) : (
          <span className="text-ink-muted">Choose {label.toLowerCase()}</span>
        )}
      </button>

      <Sheet open={open} onOpenChange={setOpen} title={label} className="flex max-h-[85svh]">
        {pending ? (
          <p className="text-body text-ink-muted">Loading…</p>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-2">
            <Input
              aria-label={`Search ${label.toLowerCase()}`}
              placeholder="Search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <ul className="flex flex-1 flex-col gap-1 overflow-y-auto">
              {filtered.map((option) => (
                <li key={option.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange(option);
                      setOpen(false);
                      setQuery("");
                    }}
                    className={cn(
                      "flex min-h-tap w-full flex-col items-start justify-center rounded-sm px-2 text-left active:bg-brand-wash",
                      rowButtonFocus,
                    )}
                  >
                    <span className="text-body text-ink-primary">{option.label}</span>
                    {option.sublabel !== undefined ? (
                      <span className="text-body-sm text-ink-muted">{option.sublabel}</span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
            {onAddNew !== undefined ? (
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onAddNew();
                }}
                className="flex min-h-tap w-full items-center justify-center rounded-sm border border-transparent bg-surface-sunken text-body text-brand-ink"
              >
                {addNewLabel}
              </button>
            ) : null}
          </div>
        )}
      </Sheet>
    </div>
  );
}

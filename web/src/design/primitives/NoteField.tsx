import { useId, useRef } from "react";
import { Label } from "./Label.js";

export interface NoteFieldProps {
  label?: string;
  value: string;
  onChange: (value: string) => void;
}

/** §6.3 `NoteField`: level 2, one line, expands as it's typed into — present on every money record, since UC §6.5's disputes are settled by notes. */
export function NoteField({ label = "Note", value, onChange }: NoteFieldProps) {
  const id = useId();
  const ref = useRef<HTMLTextAreaElement>(null);
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id}>{label}</Label>
      <textarea
        id={id}
        ref={ref}
        rows={1}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          const el = ref.current;
          if (el) {
            el.style.height = "auto";
            el.style.height = `${el.scrollHeight.toString()}px`;
          }
        }}
        className="min-h-tap w-full resize-none rounded-sm border border-transparent bg-surface-sunken px-3 py-2 text-body text-ink-primary"
      />
    </div>
  );
}

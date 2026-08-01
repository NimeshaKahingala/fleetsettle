import { fieldErrorId } from "../../lib/fieldErrorId.js";
import { Label } from "./Label.js";
import { FieldError } from "./FieldError.js";

export interface FieldProps {
  label: string;
  htmlFor: string;
  /** Placeholder is never the label (§6.3) — this marks the label itself, not a hint inside the control. */
  optional?: boolean;
  error?: string;
  children: React.ReactNode;
}

/**
 * §6.3 `Field`: top-aligned visible label, always. Required fields are
 * never asterisked — at level 1 everything is required and nothing is —
 * only "optional" ones are marked. Composes `FieldError` for the reserved
 * error slot; the control itself (passed as `children`) is responsible for
 * `id={htmlFor}`, `aria-invalid={error !== undefined}` and
 * `aria-describedby={fieldErrorId(htmlFor)}`, since `Field` doesn't clone
 * or inspect its child.
 */
export function Field({ label, htmlFor, optional = false, error, children }: FieldProps) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={htmlFor}>
        {label}
        {optional ? <span className="text-ink-faint"> (optional)</span> : null}
      </Label>
      {children}
      <FieldError id={fieldErrorId(htmlFor)} {...(error !== undefined ? { message: error } : {})} />
    </div>
  );
}

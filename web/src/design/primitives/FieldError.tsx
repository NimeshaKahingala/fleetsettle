import { AlertCircle } from "lucide-react";

export interface FieldErrorProps {
  /** The id a control's `aria-describedby` should point at, whether or not there is a message. */
  id: string;
  message?: string;
}

/**
 * §6.3 `FieldError`: the visual half of §9.2's validation-timing rules.
 * The message slot is **reserved at 20px whether or not there is an
 * error** — `h-5` — so validating on blur never reflows the form under
 * the user's thumb. Colour never carries the meaning alone: the icon and
 * the message both do.
 *
 * The 1px→2px border swap this pairs with lives on the control itself
 * (`Input`'s `aria-[invalid=true]:border-2` — see Input.tsx), which is
 * why this component doesn't render a border: the caller sets
 * `aria-invalid={error !== undefined}` and `aria-describedby={id}` on its
 * own control, and only wires message text through here.
 */
export function FieldError({ id, message }: FieldErrorProps) {
  return (
    <p id={id} className="flex h-5 items-center gap-1 text-body-sm text-critical-ink">
      {message !== undefined ? (
        <>
          <AlertCircle className="size-4 shrink-0" aria-hidden />
          <span>{message}</span>
        </>
      ) : null}
    </p>
  );
}

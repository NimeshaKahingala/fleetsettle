import { Bus, Building2, Car, Truck, type LucideIcon } from "lucide-react";
import { cn } from "../../lib/cn.js";

/**
 * Tactile Ops Phase 5 (§6/§3.1, 22 Aug 2026): a circular identity chip for
 * the three entity kinds that appear in row and detail-header contexts.
 * Vehicles and drivers are brand-tone (solid `bg-brand`, white glyph);
 * customers — person or organisation — are neutral (`bg-surface-sunken`,
 * dark glyph), since a customer isn't "ours" the way a vehicle or driver
 * is. Always `aria-hidden`: every call site already renders the entity's
 * name as real text beside this, so the chip is decorative, the same as
 * the bare icons it replaces.
 *
 * Vehicle icons are keyed on the *read-side* type, which is `z.string()`
 * (`vehicleResponseSchema`), not the closed `VehicleType` enum — legacy
 * data has spellings outside `"Bus" | "Car" | "Van"` (F-1.1/GAP-150's own
 * comment). An unrecognised value falls back to `Truck`, matching what
 * every vehicle type already rendered before this component existed —
 * strictly an improvement (Bus/Car now get their own glyph), never a
 * regression for legacy data.
 */
export type EntityAvatarSize = "list" | "detail";

interface EntityAvatarBase {
  /** `list` (36px) for a row; `detail` (48px) for a screen's own header. Defaults to `list`. */
  size?: EntityAvatarSize;
  className?: string;
}

export type EntityAvatarProps =
  | ({ kind: "vehicle"; vehicleType: string } & EntityAvatarBase)
  | ({ kind: "driver"; name: string } & EntityAvatarBase)
  | ({
      kind: "customer";
      customerType: "person" | "organisation";
      name: string;
    } & EntityAvatarBase);

const VEHICLE_ICON: Record<string, LucideIcon> = { Bus, Car, Van: Truck };

/**
 * §5B.9: `driver.name` is `z.string().trim().min(1).max(200)` — a
 * one-character name is schema-valid, and single-word names are common in
 * Sri Lanka. First letter of each of the first two whitespace-separated
 * words; for a single word, its first two characters (naturally just the
 * one character if the word itself is only one long — no separate case
 * needed). Never returns empty for any schema-valid input.
 */
function initialsOf(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0);
  const first = words[0];
  if (first === undefined) return "";
  const second = words[1];
  return second === undefined
    ? first.slice(0, 2).toUpperCase()
    : `${first[0]}${second[0]}`.toUpperCase();
}

const SIZE_CLASS: Record<EntityAvatarSize, string> = { list: "size-9", detail: "size-12" };
const ICON_SIZE_CLASS: Record<EntityAvatarSize, string> = { list: "size-[18px]", detail: "size-6" };
const TEXT_SIZE_CLASS: Record<EntityAvatarSize, string> = {
  list: "text-label",
  detail: "text-title",
};

export function EntityAvatar(props: EntityAvatarProps) {
  const size = props.size ?? "list";
  const brandTone = props.kind === "vehicle" || props.kind === "driver";
  const base = cn(
    "flex shrink-0 items-center justify-center rounded-full font-semibold",
    SIZE_CLASS[size],
    brandTone ? "bg-brand text-white" : "bg-surface-sunken text-ink-primary",
    props.className,
  );

  if (props.kind === "vehicle") {
    const Icon = VEHICLE_ICON[props.vehicleType] ?? Truck;
    return (
      <span className={base} aria-hidden>
        <Icon className={ICON_SIZE_CLASS[size]} />
      </span>
    );
  }

  if (props.kind === "customer" && props.customerType === "organisation") {
    return (
      <span className={base} aria-hidden>
        <Building2 className={ICON_SIZE_CLASS[size]} />
      </span>
    );
  }

  return (
    <span className={cn(base, TEXT_SIZE_CLASS[size])} aria-hidden>
      {initialsOf(props.name)}
    </span>
  );
}

import { Screen } from "../design/primitives/Screen.js";

export interface NotBuiltYetScreenProps {
  title: string;
  onBack?: () => void;
}

/**
 * A route that exists in §3.3's map but whose screen a later Web-P phase
 * builds — never a blank `<Outlet />`, so navigating to it is visibly "not
 * here yet" rather than indistinguishable from a broken link.
 */
export function NotBuiltYetScreen({ title, onBack }: NotBuiltYetScreenProps) {
  return (
    <Screen title={title} {...(onBack !== undefined ? { onBack } : {})}>
      <p className="text-body text-ink-secondary">Not built yet.</p>
    </Screen>
  );
}

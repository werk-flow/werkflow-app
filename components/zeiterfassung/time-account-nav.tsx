import Link from "next/link";
import { Button } from "@/components/ui/button";

export function TimeAccountNav({
  canManage,
  isAdmin,
  canProposeAdjustments,
  currentPath,
}: {
  canManage: boolean;
  isAdmin: boolean;
  canProposeAdjustments: boolean;
  currentPath: string;
}) {
  const item = (href: string, label: string) => {
    const active =
      currentPath === href ||
      (href === "/zeiterfassung/perioden" &&
        currentPath.startsWith(`${href}/`));
    return (
      <Button asChild variant={active ? "secondary" : "outline"} size="sm">
        <Link href={href} aria-current={active ? "page" : undefined}>
          {label}
        </Link>
      </Button>
    );
  };
  return (
    <nav
      aria-label="Arbeitszeitmanagement"
      className="flex flex-nowrap gap-2 overflow-x-auto"
    >
      {item("/zeiterfassung", "Zeiterfassung")}
      {item("/zeiterfassung/zeitkonto", "Zeitkonto")}
      {canManage ? item("/zeiterfassung/perioden", "Perioden") : null}
      {isAdmin
        ? item("/einstellungen/zeiterfassung", "Regeln & Export")
        : canProposeAdjustments
          ? item("/einstellungen/zeiterfassung", "Korrekturen")
          : null}
    </nav>
  );
}

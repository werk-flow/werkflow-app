interface PlaceholderSectionProps {
  title: string;
  description: string;
  icon: React.ReactNode;
}

export function PlaceholderSection({
  title,
  description,
  icon,
}: PlaceholderSectionProps) {
  return (
    <div className="rounded-lg border border-dashed bg-muted/30 p-6">
      <div className="flex flex-col items-center gap-2 text-center">
        <div className="text-muted-foreground/60">{icon}</div>
        <h4 className="text-sm font-medium text-muted-foreground">{title}</h4>
        <p className="max-w-xs text-xs text-muted-foreground/80">
          {description}
        </p>
      </div>
    </div>
  );
}

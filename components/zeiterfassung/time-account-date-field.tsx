"use client";

import { useState } from "react";
import { DatePicker } from "@/components/ui/date-picker";

function parseDate(value: string): Date {
  return new Date(`${value}T12:00:00`);
}

function formatDate(value: Date | undefined): string {
  if (!value) return "";
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function TimeAccountDateField({
  name,
  initialValue,
  ariaLabel,
}: {
  name: string;
  initialValue: string;
  ariaLabel: string;
}) {
  const [value, setValue] = useState<Date | undefined>(() =>
    parseDate(initialValue),
  );
  return (
    <>
      <input type="hidden" name={name} value={formatDate(value)} />
      <DatePicker value={value} onChange={setValue} ariaLabel={ariaLabel} />
    </>
  );
}

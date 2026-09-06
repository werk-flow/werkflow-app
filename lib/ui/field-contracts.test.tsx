import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { Field } from "@/components/ui/field";
import { DurationHoursInput } from "@/components/ui/duration-hours-input";
import { TimeInput } from "@/components/ui/time-input";
import { DatePicker } from "@/components/ui/date-picker";
import { buttonVariants } from "@/components/ui/button";
import { Select, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect, SearchableMultiSelect } from '@/components/ui/searchable-select';

describe("registered control accessibility", () => {
  for (const [name, control] of [
    ['single', <SearchableSelect key="single" options={[]} value="" onChange={() => undefined} readOnly ariaLabel="Eigener Name" />],
    ['multiple', <SearchableMultiSelect key="multiple" options={[]} selectedIds={[]} onSelectionChange={() => undefined} readOnly ariaLabel="Eigener Name" />],
  ] as const) {
    test(`${name} read-only explicit accessible name overrides its Field label`, () => {
      const html = renderToStaticMarkup(<Field label="Feldname" htmlFor="read-only-choice">{control}</Field>);
      expect(html).toContain('aria-label="Eigener Name"');
      expect(html).not.toContain('aria-labelledby="read-only-choice-label"');
    });
  }
  test("a fixed enum announces required state inherited from Field", () => {
    const html = renderToStaticMarkup(
      <Field label="Priorität" required>
        <Select>
          <SelectTrigger>
            <SelectValue placeholder="Auswählen" />
          </SelectTrigger>
        </Select>
      </Field>,
    );
    expect(html).toContain('aria-required="true"');
  });
  for (const [name, control] of [
    [
      "duration",
      <DurationHoursInput
        key="duration"
        value="1"
        onChange={() => undefined}
      />,
    ],
    ["time", <TimeInput key="time" value="08:00" onChange={() => undefined} />],
    [
      "date",
      <DatePicker key="date" value={undefined} onChange={() => undefined} />,
    ],
  ] as const) {
    test(`${name} receives the owning Field name, description and invalid state`, () => {
      const html = renderToStaticMarkup(
        <Field
          htmlFor="appointment"
          label="Terminbeginn"
          description="Berliner Ortszeit"
          error="Bitte prüfen"
          required
        >
          {control}
        </Field>,
      );
      expect(html).toContain('id="appointment"');
      expect(html).toContain(
        name === "duration"
          ? 'aria-describedby="appointment-error appointment-description"'
          : 'aria-describedby="appointment-error appointment-description appointment-required"',
      );
      if (name === "duration") {
        expect(html).toContain('aria-invalid="true"');
        expect(html).toContain('aria-required="true"');
      } else {
        // ARIA group does not support aria-invalid; its error is announced
        // through describedby and data-invalid supplies the visual state.
        expect(html).toContain('data-invalid="true"');
        expect(html).toContain('aria-labelledby="appointment-label"');
      }
    });
  }

  test("all button variants have pressed feedback", () => {
    for (const variant of [
      "default",
      "destructive",
      "outline",
      "secondary",
      "ghost",
      "link",
    ] as const) {
      expect(buttonVariants({ variant })).toMatch(/\bactive:/);
    }
  });
});

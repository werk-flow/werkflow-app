# Calendar

The calendar (`components/kalender`, `lib/calendar`) is the office's main hub. These rules add to the rest of the skill.

- **Views.** Plantafel, Tag and Monat render one surface model: rows and columns of Berlin dates, cards for timed visits, bars for all-day and multi-day visits. The Parkplatz and Einsätze panels sit beside the view, never over it.
- **Tokens.** Every calendar color is a `--calendar-*` token in `app/globals.css`. Purple marks planning. Orange stays with actions.
- **Cards.** Board cards put the title first, then time, customer and status. Day cards fit their lane with the time inline. Never copy the board anatomy into them. Chips truncate inside the card.
- **Short items.** `DAY_MIN_ITEM_WIDTH` gives a short item a minimum width. Timestamps and drag payloads keep the real duration.
- **Drag.** One engine: `components/kalender/drag-engine/drag-engine.tsx`, math in `lib/calendar/drag-math.ts`. One ghost moves by `transform`, with no React commit per pointer move. Escape cancels.
- **Optimistic owner.** `components/kalender/mutations/use-calendar-mutations.ts` moves the card before the first server call, rolls back a refusal with its sentence, and offers Undo through the inverse write after the save is confirmed.
- **Range data.** `components/kalender/use-calendar-range-data.ts` owns the window. Show a skeleton only when a dataset never loaded. While a new window loads, keep the grid with `aria-busy` and `inert`.
- **Saves.** `beginMutation()` returns a release callback. Call it in `finally`. A refresh never releases another save.
- **Messages.** Every refusal reads its sentence from `calendarRefusalMessage` in `lib/calendar/messages.ts`. No component renders a code or an inline sentence.
- **Keyboard.** Every drag has a command path („Verschieben …“, „Parken“, „Einplanen am …“). Focus returns to the card after a drop. The month grid is one tab stop with arrow keys. The `?` list is the shortcut contract. A shortcut that works in one view says so.
- **History.** A started or past occurrence is locked before anyone tries (`isStartedOccurrence`): no drag, a lock icon, the rule named in the popover.
- **Preferences.** View, horizon, density, weekend, filters, search and „Termine“ persist per user under the `calendar` key. „Arbeitszeiten“ is session state.
- **Phones.** Week and day become chronological lists without drag. Targets are at least 44 px. The month keeps its grid inside its own scroll region.

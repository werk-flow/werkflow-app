# Reviewed reference images

These images are examples of a composition that an independent review accepted. They are not owner-approved screenshot baselines and not proof of current behavior. All data is synthetic. Use them beside the component rules and the actual task. Do not copy fixture labels, and do not treat an old image as a reason to keep a defect.

| Image | Role, viewport, theme | Reviewed scope |
| --- | --- | --- |
| [Calendar day, light](2026-09-27/calendar-day-light.png) | Admin, 1440x1000, light | Toolbar and day composition with an ordinary schedule. Not proof of short-block interactions. |
| [Calendar day, dark](2026-09-27/calendar-day-dark.png) | Admin, 1440x1000, dark | The same composition in dark mode. |
| [Calendar phone](2026-09-27/calendar-phone.png) | Admin, 375x812, light | Chronological day list and phone controls without horizontal overflow. |
| [Manual entry phone](2026-09-27/manual-entry-phone.png) | Admin, 375x812, light | Loaded manual-entry form, stable frame, 44 px submit target. |
| [Customer table](2026-09-27/customers-light.png) | Admin, 1440x1000, light | Table density and action hierarchy of a populated list. |
| [Board capacity, light](2026-09-27/board-capacity-light.png) | Admin, 1440x900, light | Dense week in comfortable density: capacity and recorded hours stay below occupied lanes. |
| [Board capacity, dark](2026-09-27/board-capacity-dark.png) | Admin, 1440x900, dark | The same layout in dark mode. |
| [Planning pickers](2026-10-02/planning-pickers-light.png) | Admin, 1440x1000, light | Planning form with the employee picker open at the end of its first page: option rows, „Weitere Ergebnisse laden" with its focus ring. |
| [Empty state](2026-10-02/empty-state-light.png) | Admin, 1440x1000, light | `EmptyState` for an empty source: icon, „Noch keine …" title, next step in the description. |
| [Settings subpage](2026-10-02/settings-subpage-light.png) | Admin, 1440x1000, light | Settings area: persistent header and section nav, subpage `h2`, cards in sequence without extra gaps. |
| [Handover page](2026-10-02/handover-light.png) | Admin, 1440x1000, light | Handover detail header and section card before execution is complete. |
| [Form errors, phone](2026-10-02/form-errors-phone.png) | Admin, 390x844, light | Bottom-sheet form after an invalid submit: field errors under each field, invalid borders on searchable triggers, 44 px stacked footer. |
| [Optimistic material line](2026-10-02/material-line-pending-light.png) | Admin, 1440x1000, light | Material line in a half-width column while its save is pending: inline spinner, row stacked by container width. |
| [Document picker hint](2026-10-02/document-picker-hint-light.png) | Admin, 1440x1000, light | Attach-documents dialog with the 50-item hint below the scroll box and a visible search focus ring. |

Add an image only after the review in `docs/technical/standards-audit.md` ("Rendered design acceptance") accepted it. Remove an image when the owner rejects its composition.

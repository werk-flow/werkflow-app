# WerkFlow Styling Guidelines

## Brand Color Philosophy

WerkFlow uses a **purple and orange** color scheme with clear semantic meaning:

### Color Roles

| Role | Color | Usage |
|------|-------|-------|
| **Primary (Orange)** | `#ff7900` | Action buttons, CTAs, elements that need to pop and stand out |
| **Secondary (Purple)** | Purple shades | General UI enhancement, backgrounds, borders, non-critical interactive elements |

### Rule: Never Mix Purple and Orange in the Same Component

**CRITICAL**: Purple text should never appear on an orange background, and orange text should never appear on a purple background.

Valid combinations:
- ✅ Orange background + white/neutral text
- ✅ Purple background + white/neutral/purple text  
- ✅ Neutral background + orange OR purple text
- ❌ Orange background + purple text
- ❌ Purple background + orange text

### When to Use Each Color

**Use Orange (`primary`) for:**
- Submit buttons
- Call-to-action buttons
- Important links that need attention
- Success states
- Elements that should draw immediate user attention

**Use Purple (`secondary`, `accent`, `muted`) for:**
- Navigation highlights
- Hover states on non-critical elements
- Borders and dividers
- Background tints for visual interest
- Secondary buttons
- Tags and badges
- General UI polish

### Tailwind Classes Reference

```
Primary (Orange actions):     bg-primary, text-primary, ring-primary
Secondary (Purple general):   bg-secondary, text-secondary-foreground
Accent (Purple subtle):       bg-accent, text-accent-foreground
Muted (Purple neutral):       bg-muted, text-muted-foreground
```

### Brand Color Variables (for custom usage)

```css
--brand-orange: #ff7900;        /* Main orange */
--brand-orange-light: #ff9e00;  /* Lighter orange */
--brand-orange-dark: #cc6100;   /* Darker orange */
--brand-purple: #7b2cbf;        /* Main purple */
--brand-purple-light: #9d4edd;  /* Lighter purple */
--brand-purple-dark: #5a189a;   /* Darker purple */
--brand-purple-deep: #3c096c;   /* Deepest purple */
```

### Dark Mode Considerations

- Dark mode uses slightly desaturated purples for backgrounds to avoid harsh saturation
- Orange primary color is slightly brightened in dark mode for better visibility
- All color pairing rules apply equally to dark mode

## Logo Usage

- Light mode: `/logo-text-light.svg` or `/logo-icon-light.svg`
- Dark mode: `/logo-text-dark.svg` or `/logo-icon-dark.svg`
- Use `dark:hidden` and `hidden dark:block` classes to swap between them


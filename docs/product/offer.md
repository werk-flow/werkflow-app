# Product Offer

This document is still a placeholder for the complete WerkFlow offer.

The offer should describe the product package around the app, including services that may be sold alongside the software, such as onboarding support or an initial inventory audit.

## Confirmed Direction

The surrounding service should include substantial product enablement rather than expecting a trade business to configure and learn a deep operating suite alone:

- in-person workshops;
- video courses;
- guided onboarding and operational training;
- help understanding how connected WerkFlow workflows should be used in the business.

The exact format, duration, staffing, entitlement, price, service level, and package boundary are not yet defined. Do not turn this direction into a sales promise without a later offer decision.

## Not Yet Defined

Do not invent pricing, guarantees, detailed onboarding promises, service levels, or sales claims from this placeholder. Ask the product owner before using those assumptions in product or implementation work.

## Known Cost Input: File Storage Allowance

One infrastructure fact is settled enough to constrain future packaging ([decision 0001](../decisions/0001-infrastructure-stack.md)): the marginal infrastructure cost per onboarded business is dominated by file storage, roughly `$15/month per stored terabyte` (Cloudflare R2, downloads free) plus a small archive copy. Database, auth, and hosting marginal costs are near zero at typical SHK team sizes.

Packaging must therefore include an explicit storage allowance per organization (for example, an included volume plus paid tiers) instead of unlimited storage. Whether a typical business stores hundreds of gigabytes or multiple terabytes is **unvalidated** — original-resolution photos and videos, not PDFs, will drive the number. TODO: measure real storage growth with the first onboarded businesses before fixing allowance tiers or prices.

## Future Topics

- Packaging and plan structure.
- Pricing assumptions.
- Onboarding service.
- Initial inventory audit.
- Support model.
- Guarantees or risk reversal.
- Common objections.
- What is included and excluded.

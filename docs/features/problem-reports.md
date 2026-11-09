# Problem reports

A member reports a problem from the app to WerkFlow support. The report stays in WerkFlow's private EU storage, only its reporter and WerkFlow support read it, and it is deleted on the owner's periods.

## Current Product Baseline

The server stores, reads and deletes reports. No screen offers them yet.

- **Report.** Admin, Büro and employees submit a report in an organization where they are a current member. It holds the original description, up to 5,000 characters, and the captured context. The context has a fixed shape and nothing else: the route template, recent actions as route templates and control labels, client errors (name, code, digest, route template), the app version, the device (platform, browser, viewport) and the offline state. A route template carries no value: each segment is a route word or a `[parameter]` name.
- **States.** A report starts as `eingegangen`, then moves through `in_bearbeitung` to `erledigt` or `abgelehnt`. Its bucket is `blocker`, `fehler`, `unklarheit` or `wunsch`. The scrubbed copy is `ausstehend` until the scrubber writes it, and `nicht_bereinigbar` when the text cannot be scrubbed; then no copy exists.
- **Files.** The person who filed a report adds one screenshot (PNG, JPEG or WebP, up to 5 MB) and up to five attachments (those types, HEIC or PDF, up to 15 MB), while the report keeps its originals. [Report files](../technical/document-storage-and-access.md#report-files) owns the storage rules.
- **Reading.** A reporter reads only their own reports in the active organization, with status and support's response. No `admin`, `buero` or `employee` reads another person's report, and the organization export leaves reports out.
- **Support.** WerkFlow support is the persons of the data processing agreement's § 5(2), named per environment by their Auth user ids in the server setting `SUPPORT_USER_IDS`, comma-separated. Support is no organization role. It opens a report of any organization with its originals and file list, and each opening of an original enters the report's history before the original leaves the server. A missing, empty or malformed setting refuses every support operation.
- **History.** A report's history records status, bucket, assignee and response changes and every opening of an original, with actor and time. It refuses changes and deletion and goes only with its report.
- **Deletion periods** (owner's answer on werk-flow/werkflow-planning#21). The originals (description, context, screenshot, attachments) are deleted 90 days after the report closes as `erledigt` or `abgelehnt`, at the latest 12 months after it was sent. The scrubbed copy is deleted 24 months after the report closes, with the report, its status and its history. A daily run, `/api/problem-report-retention` on production, applies both; the deleted files reach the [storage purge](../technical/document-storage-and-access.md#storage-cleanup). An account deletion takes the person's reports along, an organization deletion all of its reports.

### Current limits

- Nothing triages, assigns, answers or sorts a report yet, so every report stays `eingegangen` and its originals go 12 months after sending.
- No scrubber writes the scrubbed copy yet, and no copy leaves WerkFlow.
- Support sees a report's file list but opens no file.

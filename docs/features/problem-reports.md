# Problem reports

A member reports a problem from the app to WerkFlow support. The report stays in WerkFlow's private EU storage, only its reporter and WerkFlow support read it, and it is deleted on the owner's periods.

## Current Product Baseline

The database stores reports and deletes them on their periods. No screen or action submits, uploads or reads one yet, and no support access exists.

- **Report.** A report belongs to an organization and its reporter. It holds the original description, up to 5,000 characters, and the captured context, a JSON object. It names who filed it, which differs from the reporter only when support files it for a caller.
- **States.** A report starts as `eingegangen`, then moves through `in_bearbeitung` to `erledigt` or `abgelehnt`; a closed report carries its closing time. Its bucket is `blocker`, `fehler`, `unklarheit` or `wunsch`. The scrubbed copy is `ausstehend` until the scrubber writes it, and `nicht_bereinigbar` when the text cannot be scrubbed; then no copy exists.
- **Files.** A report keeps at most one screenshot beside its attachments, and takes no file once its originals are deleted. [Report files](../technical/document-storage-and-access.md#report-files) owns the storage rules.
- **No customer reads a report.** The report tables are server-only: no `admin`, `buero` or `employee` reads one through the Data API, and the organization export leaves them out.
- **History.** A report's history holds status, bucket, assignee and response changes and every opening of an original by support, with actor and time. It refuses changes and deletion, goes only with its report, and keeps the actor's id after that account is deleted.
- **Fixed identity.** A report's organization, reporter and sending time never change, and its originals change only through the deletion run.
- **Deletion periods** (owner's answer on werk-flow/werkflow-planning#21). The originals (description, context, screenshot, attachments) are deleted 90 days after the report closes, at the latest 12 months after it was sent. The scrubbed copy is deleted 24 months after the report closes, with the report, its status and its history. A daily run, `/api/problem-report-retention` on production, applies both, one database call per report; the deleted files reach the [storage purge](../technical/document-storage-and-access.md#storage-cleanup). Its answer and logs carry counts only. An account deletion takes the reports the person reported along, an organization deletion all of its reports.

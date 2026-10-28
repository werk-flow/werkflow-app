---
name: file-pr
description: Use when you file, open or create a pull request.
---

Adapted for WerkFlow from t3dotgg/tstack (MIT, [license](../LICENSE-tstack)).

# File PR

1. Run `gh pr list --head <branch>`. If a PR exists, update it instead.
2. Read the diff against `origin/main`. It solves one problem and matches the goal.
3. Write the title. It becomes the squash commit: plain English, what changes for the user or developer, no type prefix. Copy the style of `git log --oneline origin/main`.
4. Write the body in the sections of `.github/pull_request_template.md`:
   - **Problem:** what was wrong or missing, and for whom, in the owner's terms. Then how the change solves it. Never open with a file inventory.
   - **Verification:** one line on how you proved it, then what you ran and saw.
   - **Review:** the [review level](../../../docs/technical/coderabbit.md#choose-the-review-level) with its reason, and the sol-loop line for level 1 and 2.
   - End with the model and harness that did the work, as the template shows.
5. Check the title, body and attachments for secrets and personal data.
6. Open a real PR, never a draft: `gh pr create --base main --title <title> --body-file <file>`. If GraphQL is used up: `gh api repos/<owner>/<repo>/pulls -f title=<title> -f head=<branch> -f base=main -F body=@<file>`.
7. Call `link_pull_request` with the PR URL.

Bad problem line:

> Added a poll on the job-number field in the job spec helper and removed the retry wrapper.

Good:

> The new-job test sometimes typed its job number while the form still loaded the suggested one, so it failed at random. The test now waits for the suggestion.

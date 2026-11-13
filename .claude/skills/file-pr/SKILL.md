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
6. Open it as a draft: `gh pr create --draft --base main --title <title> --body-file <file>`. If GraphQL is used up: `gh api repos/<owner>/<repo>/pulls -f title=<title> -f head=<branch> -f base=main -F draft=true -F body=@<file>`. Open it before `sol-loop`'s first round. In [trial mode](../../../docs/technical/coderabbit.md#trial-mode-until-2026-11-27), label a level 1 or 2 PR at once: `gh pr edit <number> --add-label needs-coderabbit`, so CodeRabbit reviews the draft while Sol's round runs. A draft runs no browser shard; mark it ready when its reviews are done ([babysit a pull request](../../../docs/technical/coderabbit.md#babysit-a-pull-request)).
7. Call `link_pull_request` with the PR URL.
8. Screenshots: `gh` cannot attach an image to a PR, so each image is an asset of the `pr-screenshots` prerelease. Name it `pr<number>-<what>.png`, upload it with `gh release upload pr-screenshots <file>`, embed `https://github.com/werk-flow/werkflow-app/releases/download/pr-screenshots/<name>` in the body, and update the PR with `gh pr edit <number> --body-file <file>`. The repository is public: synthetic data only. Never commit a PR-only image or push a branch for one. `.github/workflows/pr-screenshots.yml` deletes a PR's assets when it closes.

Bad problem line:

> Added a poll on the job-number field in the job spec helper and removed the retry wrapper.

Good:

> The new-job test sometimes typed its job number while the form still loaded the suggested one, so it failed at random. The test now waits for the suggestion.

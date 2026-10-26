---
name: file-pr
description: Use when you file, open or create a pull request.
---

Adapted for WerkFlow from t3dotgg/tstack (MIT, [license](../LICENSE-tstack)).

# File PR

1. Check whether a PR for this branch exists: `gh pr list --head <branch>`. If one does, update it instead.
2. Read the diff against `origin/main` and check that it matches the goal and solves one problem.
3. Write the title. It becomes the squash commit on `main`, so it follows the history: plain English, what changes for the user or the developer, no type prefix. Look at `git log --oneline origin/main` for examples.
4. Write the description in the sections of `.github/pull_request_template.md`.
5. Check the title, the description and every attachment for secrets, personal data and private details.
6. Open a real PR, never a draft: `gh pr create --base main --title <title> --body-file <file>`. If GraphQL is used up, open it through REST: `gh api repos/<owner>/<repo>/pulls -f title=<title> -f head=<branch> -f base=main -F body=@<file>`.
7. Call `link_pull_request` with the PR URL, then babysit it as [Babysit a pull request](../../../docs/technical/coderabbit.md#babysit-a-pull-request) describes.

## The description

**Problem** opens with the problem in plain language, taken from the owner's original request: what was wrong or missing, and for whom. Then, briefly, how this change solves it. Do not lead with an inventory of changed files and functions.

BAD

> Added a poll on the job-number field in the job spec helper, replaced three `fill` calls, and removed the retry wrapper from the create-job journey.

GOOD

> The new-job test sometimes typed its own job number while the form was still loading the suggested one, so it failed at random. The test now waits for the suggestion before it types.

**Verification** says in one line how you proved the change, then what you ran and what you saw.

**Review** states the level and its reason ([review levels](../../../docs/technical/coderabbit.md#choose-the-review-level)), then the sol-loop line for level 1 and 2.

End the description with the model and harness that did the work, as the template shows. Name subagent models that wrote part of the change. Use the model name the harness reports; if it reports none, name only the harness.

Post a follow-up comment only when the task needs one, with the `leaving-pr-comments` skill.

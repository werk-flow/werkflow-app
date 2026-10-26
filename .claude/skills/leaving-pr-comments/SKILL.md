---
name: leaving-pr-comments
description: Use whenever you leave a comment or a review reply on GitHub.
---

Adapted for WerkFlow from t3dotgg/tstack (MIT, [license](../LICENSE-tstack)).

# Leaving PR comments

Agents post with the owner's GitHub account, so every comment an agent writes opens with this note:

```md
> [!NOTE]
> 🤖 **<model> responding on behalf of <login>**

The comment starts here.
```

`<model>` is the public name of the model that wrote the comment, as the harness reports it; if it reports none, use the harness name. `<login>` is the account's login (`gh api user --jq .login`). Never guess either.

Apply the note to top-level PR comments, inline review comments, replies to CodeRabbit or a person, and the written reason before you resolve or dismiss a finding. Leave it off PR descriptions, commit messages, and text the owner asked you to post verbatim.

Keep the attribution inside the note and the reply below it. The note's line starts with the robot emoji. Add no rule, heading, signature or second attribution.

Write the comment in English, directly:

- Lead with the conclusion.
- Cite the code, behavior, check or reproduction.
- For a fixed finding, say what changed and the tier where its prevention landed ([decision 0005](../../../docs/decisions/0005-enforcement-ladder.md)).
- Keep it short: no filler, no thanks, no status narration.
- Separate verified facts from judgment.

Before you post, check the whole comment, quotes and attachments included, for secrets and personal data, and preview the Markdown so the note renders. After you post, confirm that GitHub returned the comment URL. Resolve a review thread only after its reply posted.

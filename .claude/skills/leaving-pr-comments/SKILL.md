---
name: leaving-pr-comments
description: Use whenever you leave a comment or a review reply on GitHub.
---

Adapted for WerkFlow from t3dotgg/tstack (MIT, [license](../LICENSE-tstack)).

# Leaving PR comments

Agents post with the owner's account. Open every comment, inline comment, review reply and resolve reason with this note:

```md
> [!NOTE]
> 🤖 **<model> responding on behalf of <login>**

The comment starts here.
```

- `<model>` is the model name the harness reports, or the harness name. `<login>` comes from `gh api user --jq .login`. Never guess either.
- Leave the note off PR descriptions, commit messages and text the owner asked you to post verbatim.
- Add no second attribution, signature or heading.

Write in English:

- Lead with the conclusion.
- Cite the code, check or reproduction.
- For a fixed finding, say what changed and the tier of its prevention ([decision 0005](../../../docs/decisions/0005-enforcement-ladder.md)).
- No filler, no thanks, no status narration.
- Separate verified facts from judgment.

Before you post, check for secrets and personal data. After, confirm GitHub returned the comment URL. Resolve a thread only after its reply posted.

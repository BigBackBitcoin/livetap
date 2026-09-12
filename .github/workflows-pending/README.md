# Pending workflows

These GitHub Actions workflows are complete but could not be pushed from the build host: the
available GitHub token has `repo` scope only, and GitHub refuses to create or update files under
`.github/workflows/` without the `workflow` scope.

Human action (one time, ~1 minute):

```bash
gh auth refresh -h github.com -s workflow
git mv .github/workflows-pending/*.yml .github/workflows/
git commit -m "ci: enable GitHub Actions workflows" && git push
```

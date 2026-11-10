# The Ignored Build Step of the Vercel project werkflow-app (project settings, Git): the line below,
# pasted as it stands. Exit 1 builds, exit 0 skips, so only production and staging (main) build.
# The weekly health check fails when the project's setting differs from this line; change both
# together (docs/technical/environments.md#vercel).
if [ "$VERCEL_ENV" = production ] || [ "$VERCEL_GIT_COMMIT_REF" = main ]; then exit 1; fi; echo "Skipped: this project builds only production and staging (main)."; exit 0

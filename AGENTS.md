# Codex Instructions

## Worktree And PR Workflow

- For any code or documentation change, do not edit the main checkout directly unless the user explicitly asks for it.
- Create a new git worktree from the repository default branch and work on a dedicated `codex/...` branch.
- Keep the main checkout clean. If changes accidentally land there, move them into a feature worktree before continuing.
- Stage only the intended files, commit the scoped change, push the branch, and open a draft pull request.
- Run the most relevant available checks before opening the pull request, and mention any checks that could not be run.
- Do not overwrite, reset, or include unrelated local/user changes from other worktrees.

## Package Boundary Discipline

- Do not patch consumer apps with Latticework runtime shims, copied services, or compatibility stand-ins for runtime APIs.
- If Latticework fails in a consuming bundler or framework, fix the source/build/export surface in this package and then update the consumer dependency pin.
- For temporary local verification, link or install a built package artifact only; do not commit consumer-local copies of package runtime behavior.

## Matching LoomLarge Test PRs

- When a Latticework change needs LoomLarge validation, create a matching LoomLarge PR from a fresh LoomLarge worktree.
- Do not commit direct `meekmachine/Latticework` git pins into LoomLarge package manifests; LoomLarge CI expects linked dependency testing to come from PR body references such as `meekmachine/Latticework#123`.
- If there is already a LoomLarge feature PR that consumes the Latticework work, base the matching test PR on that feature branch so the diff stays scoped to the integration/test trigger.
- Open the matching LoomLarge PR as draft, confirm CI/local validation, then merge that matching PR yourself into the LoomLarge feature branch when the user has asked you to own the integration flow.

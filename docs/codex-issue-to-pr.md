# Codex issue-to-PR

Run these tasks from the repository's main checkout in VS Code:

| Task | Purpose |
| --- | --- |
| **Codex: issue to PR - plan** | Read the issue, check required fields and approved commands, and preview the worktree location. No model calls. |
| **Codex: issue to PR - run** | Create/resume the issue worktree; plan, implement, review, repair and verify. Stops at `ready_to_publish`. |
| **Codex: issue to PR - publish verified draft** | Recheck evidence, push the verified branch and open a draft PR. |

Configure `.codex/issue-to-pr/config.json` before running. `verify_commands` must list your real checks as command-argument arrays. The issue's commands must match `verify_commands` or `allowed_issue_commands` exactly after parsing their quoted arguments. Commands are executed directly without shell expansion. UI paths require a configured `browser_command` that runs the app's existing browser tests.

The installed files, `.gitignore` entries and repository instructions must be committed onto the remote base branch before the first run. Dependencies must be provisioned in the separate worktree. Use GitHub's **Codex agent task** issue form (or the original **Agent task** form), with an objective, in-scope file/directory paths, acceptance criteria and verification commands. Include test directories in scope.

Terminal equivalents:

```bash
python3 .codex/issue-to-pr/runner.py 42 --plan
python3 .codex/issue-to-pr/runner.py 42 --run
python3 .codex/issue-to-pr/runner.py 42 --publish
```

On native Windows, use `python`. Tasks already make that substitution. Codex and `gh` must be on PATH and authenticated in the environment where the task runs.

The implementation is in `.issue-to-pr-worktrees/issue-42` on `codex/issue-42`. Open that folder in a second VS Code window to inspect the changes. Keep the main checkout window for launching these tasks. Each run gets fresh Codex sessions and checks their reported commit and full file list against Git. Model selection follows the CLI defaults unless configured per role.

The latest result is `.issue-to-pr-worktrees/issue-42/artifacts/issue-to-pr/issue-42/STATUS.json`. Its `evidence` path points to prompts, events, results, logs and the proposed PR body. Logs stay on the machine. A clean run starts seven Codex sessions; three rounds start at most 19. Each session may make many model requests and consumes your account's available usage.

`needs_plan_review` identifies sensitive areas and lists labels such as `plan-approved:authorization`. Review the plan and add the named labels yourself before rerunning. The controller never adds them. A changed issue or configuration requires a new verified run; publishing also rejects a changed commit, dirty worktree, revoked approval or advanced remote base.

For a blocked run, fix the reported cause. Inspect uncommitted work before committing, stashing or reverting it yourself. The controller never deletes it. A stale repository lock should only be removed after confirming the prior run and its children have stopped.

This controller calls Codex CLI sessions from VS Code's task terminal. It does not register a sidebar slash command or attach the CLI sessions to an existing sidebar chat. It has no action for approving, merging, deploying or force-pushing. Codex sandbox settings apply to workers; configured tests run as your user, and inherited MCP/plugin capabilities require your own account-level controls. Use normal repository permissions and branch protection.

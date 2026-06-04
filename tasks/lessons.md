
## CWD drift between Bash calls (2026-06-04)
The shell re-initializes from the user's profile between some Bash calls, so the
working directory can silently reset from the project dir to the PARENT
`/Users/laptop/Projects/lerobot` — which is a DIFFERENT git repo
(so101-jetson-rig-dashboard). A bare `git push` there failed/targeted the wrong
repo; a bare `tsc` failed with "no such file". No work was lost (commits were
made while CWD happened to be correct), but this could have been catastrophic.
RULE: prefix EVERY Bash command that touches the project (git, tsc, npm, file
ops) with `cd /Users/laptop/Projects/lerobot/digital-twin-camera-planner && ...`.
Never run a bare git/tsc command assuming CWD persists.

## Backticks in `git commit -m "..."` get shell-executed (2026-06-04)
A commit message passed via `-m "...`compare` overlay..."` inside DOUBLE quotes had
the backtick-wrapped words command-substituted by the shell (`compare: command not
found`) and SILENTLY DELETED from the message. The commit still succeeded, mangled.
RULE: for commit messages containing backticks/`$`/`!`, write the message to a temp
file and use `git commit -F /tmp/msg.txt` (or `--amend -F`). Never inline backticks
in a double-quoted `-m`.

## Playwright MCP writes screenshots to the PARENT repo dir (2026-06-04)
`browser_take_screenshot({filename:'x.jpeg'})` saved to `/Users/laptop/Projects/lerobot/x.jpeg`
(the parent repo, CWD-drift again), NOT the project dir. Find via
`find /Users/laptop/Projects/lerobot -maxdepth 1 -name x.jpeg`, Read it, then rm it so it
never lands in the wrong repo's git. (Verifying images this way works well.)

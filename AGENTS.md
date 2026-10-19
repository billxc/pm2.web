# Repository instructions

## Default completion workflow

- Unless the user explicitly says not to commit or push, finish requested changes with focused validation, a focused Git commit, and a push to the current branch on `origin`.
- `origin` is the personal fork `https://github.com/billxc/pm2.web.git`. `upstream` is the original project; never push there unless explicitly requested.
- Do not stop at “committed locally, not pushed” or request routine push confirmation. If authentication, permissions, conflicts, or validation block completion, report the blocker accurately.
- Preserve unrelated and concurrent changes. Never force-push, rewrite published history, or include unreviewed changes merely to complete a push.

## Privacy and scope

- Review outgoing files and commits for credentials, personal hostnames/IPs, real user paths, private logs/screenshots, and deployment data before pushing. Keep real environment files and operational artifacts out of Git; use generic examples and a GitHub noreply commit email.
- A push is not a deployment. Deployment, service restarts, database migrations, and permission changes retain their own authorization and verification requirements; this default applies only to this repository.

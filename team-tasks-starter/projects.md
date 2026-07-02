# Projects registry

The `project:` field on every task must match a `name` below. This is how a teammate's Claude
knows which repo to clone/set up. Keep `local path` **relative** (sibling of this hub) so it
works the same on everyone's machine.

`profile` = the sharpSoftAIBase profile to install: `nextjs-supabase-vercel`, `python-service`,
or `minimal`.

| name   | clone URL                              | profile                | local path |
|--------|----------------------------------------|------------------------|------------|
| app-a  | git@github.com:YOUR_ORG/app-a.git      | nextjs-supabase-vercel | ../app-a   |
| lib-b  | git@github.com:YOUR_ORG/lib-b.git      | python-service         | ../lib-b   |
| book-c | git@github.com:YOUR_ORG/book-c.git     | minimal                | ../book-c  |

<!--
Replace the example rows above with your real repos. Add a row per project.
- Use SSH URLs if your team authenticates with SSH keys; HTTPS otherwise.
- `minimal` profile is fine for non-code projects (docs, books, research) — the task flow is
  identical, only the installed skills differ.
-->

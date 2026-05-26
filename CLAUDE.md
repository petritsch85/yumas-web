@AGENTS.md
@../../_shared/BRAND.md

## Dev Workflow
- After every code change: `git add -A && git commit -m "<message>" && git push origin master`
- Vercel auto-deploys on every push to master — no manual deploy needed
- Do NOT run `npm run dev` — it crashes the developer's PC
- All testing is done on the live Vercel URL after pushing

# Daniel’s Meal Coach

Static dashboard for daily nutrition against personal quotas, plus Apple Fitness rings, steps, and distance. Labels are Traditional Chinese (Hong Kong). Numbers stay in English.

The page only reads `data.json`. It does not invent meals, and it does not call a Google Sheet.

## View on GitHub Pages

After this change is on `main` and Pages is enabled:

https://danielwongcx.github.io/meal-coach/

This environment cannot change repository settings. Enable Pages once:

1. Open [Settings → Pages](https://github.com/danielwongcx/meal-coach/settings/pages).
2. Build and deployment: **Deploy from a branch**.
3. Branch: **main**, folder: **/ (root)**. Save.
4. Wait for the deployment, then open the URL above.

A `.nojekyll` file is included so GitHub Pages serves the files as-is.

## Open locally

`file://` pages cannot `fetch` `data.json`. From the repo root:

```bash
python3 -m http.server 8080
```

Open http://localhost:8080/

No build step and no CDN. Chart drawing is plain SVG.

A day can be opened directly with a hash, for example `http://localhost:8080/#2026-10-14`.

## How to read the colours

- Green: near the calorie or carb target, protein or fibre met, or a cap still comfortably under.
- Amber: near a sugar or sodium cap, or just over it.
- Red: clearly over (more than about 10% past a cap, or more than about 20% past calories or carbs).
- Warm brown: protein or fibre short on a finished day.
- Sage: the day is still in progress (`"partial": true`), so a low number is not treated as a miss.

Sugar and sodium are caps. Fibre and protein are targets. Calories and carbs are “stay near the line”. Fat is hidden unless a day includes `fat` (the quota can still sit in `quotas`).

## Refresh `data.json` from a Google Sheet

Do not commit API keys, OAuth tokens, or a service-account file.

1. Keep the sheet columns aligned with the fields below.
2. Copy the numbers into `data.json` (same shape). Bump `updatedAt` (include the offset, e.g. `2026-10-19T12:00:00+08:00`).
3. For a day that is not finished, set `"partial": true`. Remove that flag when the day is final.
4. Add a `fitness` row only when that day’s rings were recorded. Skip the date if there is no export.
5. Commit `data.json` and push to `main`. Pages updates on the next deploy.

```json
{
  "updatedAt": "2026-10-19T12:00:00+08:00",
  "quotas": {
    "kcal": 1950,
    "carbs_g": 190,
    "fat_g": 65,
    "sugar_g": 30,
    "fiber_g": 28,
    "protein_g": 135,
    "sodium_mg": 2000
  },
  "daily": [
    {"date":"2026-10-19","kcal":457,"carbs":34,"sugar":16,"fiber":7,"protein":23,"sodium":219,"partial":true}
  ],
  "fitness": [
    {"date":"2026-10-17","move":524,"exercise":30,"stand":9,"steps":8421,"km":6.6}
  ],
  "fitnessGoals": {"move":360,"exercise":30,"stand":12}
}
```

`move` is active kilocalories, `exercise` is minutes, `stand` is hours. Optional `fat` on a daily row (grams) will show a fat bar automatically.

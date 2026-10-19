# Daniel’s Meal Coach

Static dashboard for daily nutrition against personal quotas, plus Apple Fitness rings, steps, and distance. Labels are Traditional Chinese (Hong Kong). Numbers stay in English.

The page only reads `data.json`. It does not invent meals, and it does not call a Google Sheet.

## View on GitHub Pages

https://danielwongcx.github.io/meal-coach/

Pages is already turned on for this repo: deploy from branch **main**, folder **/ (root)**. Merging to `main` publishes the latest dashboard to the URL above.

A `.nojekyll` file is included so Pages serves the files as-is. If Pages was ever switched off, turn it back on at [Settings → Pages](https://github.com/danielwongcx/meal-coach/settings/pages) with branch `main` and folder `/ (root)`.

## Open locally

`file://` pages cannot `fetch` `data.json`. From the repo root:

```bash
python3 -m http.server 8080
```

Open http://localhost:8080/

No build step. Charts use [Chart.js](https://www.chartjs.org/) 4.4.6 (MIT), saved as `chart.umd.min.js`. Each chart draws left to right with an ease-in (`easeInQuad`) whenever it scrolls into view, and again after it leaves and comes back. The 今日 meters grow the same way. `prefers-reduced-motion` skips that animation. The page stays within the screen width; wide tables scroll inside their own area.

The header button switches dark and light. The choice is stored in `localStorage` (`meal-coach-theme`). With nothing stored, the page follows the system theme. Nutrition trends cover every number in `daily` (熱量、碳水、糖、纖維、蛋白、鈉, plus fat when a row has it). Fitness trends cover 活動、運動、站立、步數, and 公里. Goal lines are drawn only where `quotas` or `fitnessGoals` has a number. Steps and kilometres have no goal line.

The 今日 card swipes sideways through `daily` (newest first). The round button at the bottom right jumps to 今日、走勢、活動、建議、補數. 每日數字 opens from the button in 近日走勢, in a dialog you can close with the X, the backdrop, or Escape. Short tips live in `advice` (`eating` and `meals`). The 爭邊樣 lines are calculated from the day on screen. Protein and fibre ideas live in `foodLists` (`protein`, `fiber`, optional `tips`) and show under 建議 and 補數.

A day can be opened directly with a hash, for example `http://localhost:8080/#2026-10-14`. Section links (`#advice` and the others) do not change the selected day.

## How to read the marks

- 🔴超: over 110% of the quota or cap.
- 🟡近: about 85–110%.
- 🟢低: under 85% of calories, carbs, protein, or fibre.
- 🟢好: under 85% of a sugar or sodium cap. That is under the cap, not a cue to add more.

A day with `"partial": true` still uses these marks. The card itself says 進行中.

Sugar and sodium are caps. Fibre and protein are targets. Calories, carbs, and fat are “stay near the line”. Fat is hidden unless a day includes `fat` (the quota can still sit in `quotas`).

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
  "fitnessGoals": {"move":360,"exercise":30,"stand":12},
  "advice": {
    "eating": ["少醬，飯食半碗，菜多一點。"],
    "meals": ["蒸蛋、豆腐、白魚：軟身，蛋白高。"]
  }
}
```

`move` is active kilocalories, `exercise` is minutes, `stand` is hours. Optional `fat` on a daily row (grams) will show a fat bar automatically.

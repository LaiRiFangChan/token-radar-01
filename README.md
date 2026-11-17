# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/LaiRiFangChan/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/LaiRiFangChan/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token launch radar: ranks pre-token protocols by implied value from a sealed DefiLlama snapshot, with a concrete farm plan for each. Built for make.fun's "Build the best token launch radar" bounty ($1,325 in USDC).

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input snapshot.json
```

The grader mounts the sealed snapshot at `/input/snapshot.json`; `main.ts` reads it, writes the ranked board to `/output/board.json`, the dashboard data to `/output/data.js`, and copies `dashboard/` and `screenshots/` to `/output`.

---

<sub>Entered on [make.fun](https://make.fun/?ref=kf4hzja1&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>

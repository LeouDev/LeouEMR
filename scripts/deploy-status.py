"""
One-shot deploy check for a commit on main: the Vercel deployment states
GitHub records for it and the CI workflow's status.

    python3 scripts/deploy-status.py <full 40-character sha>

Prints one line, e.g.
    deploy: Preview=success Production=success | ci: CI:completed/success
"none-yet" means GitHub has nothing for that sha yet. Pass the FULL sha —
the workflow-runs query does not match a short one. Unauthenticated, so
it is rate-limited to 60 calls an hour; poll every 45 seconds or so:

    for i in $(seq 1 14); do python3 scripts/deploy-status.py <sha>; sleep 45; done
"""
import json, sys, urllib.request
sha = sys.argv[1]
def get(u):
    return json.load(urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": "poll"})))
ds = get(f"https://api.github.com/repos/LeouDev/LeouEMR/deployments?sha={sha}")
dep = []
for d in ds:
    st = get(d["statuses_url"])
    dep.append(d["environment"] + "=" + (st[0]["state"] if st else "none"))
rs = get(f"https://api.github.com/repos/LeouDev/LeouEMR/actions/runs?head_sha={sha}").get("workflow_runs", [])
ci = [r["name"] + ":" + r["status"] + "/" + str(r["conclusion"]) for r in rs]
print("deploy:", " ".join(dep) or "none-yet", "| ci:", " ".join(ci) or "none-yet")

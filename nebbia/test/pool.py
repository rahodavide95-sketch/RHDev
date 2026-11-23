"""Renders many scenarios with test/render.js in parallel node processes (one per CPU)."""
import json
import os
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
DEMO = os.path.join(HERE, "..", "demo")


def render_many(scen, procs=None):
    procs = procs or os.cpu_count() or 2
    keys = list(scen)
    chunks = [keys[i::procs] for i in range(procs)]
    running = []
    for ci, chunk in enumerate(chunks):
        if not chunk:
            continue
        tmp = os.path.join(DEMO, "_pool_%d.json" % ci)
        json.dump({k: scen[k] for k in chunk}, open(tmp, "w"))
        running.append((tmp, subprocess.Popen(["node", os.path.join(HERE, "render.js")],
                                              env=dict(os.environ, NEBBIA_SCENARIOS=tmp),
                                              stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)))
    stats = {}
    for tmp, pr in running:
        out, _ = pr.communicate()
        os.remove(tmp)
        for line in out.splitlines():
            if line.startswith("["):
                stats[line.split("]")[0][1:]] = line
    return stats

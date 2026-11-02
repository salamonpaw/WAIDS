#!/usr/bin/env python3
"""WAIDS — diagnostyka + samonaprawa (uruchamiane z crona co minutę jako root).

1. Zbiera stan VM / Dockera / kontenerów i zapisuje go do /var/www/waids/health.json.
   nginx serwuje ten plik statycznie, więc ekran logowania może pokazać przyczynę
   awarii nawet gdy backend nie działa (502).
2. Jeśli Docker działa, a kontenery WAIDS nie — wykonuje `docker compose up -d`
   (najwyżej raz na HEAL_INTERVAL; pomija w trakcie deploy.sh).

Tylko biblioteka standardowa — działa na systemowym python3.
"""
import json
import os
import shutil
import subprocess
import time
import urllib.request
from datetime import datetime, timezone

APP_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_FILE = "/var/www/waids/health.json"
STATE_FILE = "/var/lib/waids-health/state.json"
DEPLOY_LOCK = "/run/waids-deploy.lock"
CONTAINERS = ["waids_db", "waids_backend"]
HEAL_INTERVAL = 5 * 60      # s — minimalny odstęp między próbami naprawy
DEPLOY_LOCK_MAX_AGE = 30 * 60
LOG_LINES = 25


def run(cmd, timeout=20):
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return p.returncode, (p.stdout + p.stderr).strip()
    except Exception as e:
        return -1, str(e)


def iso(ts):
    return datetime.fromtimestamp(ts, timezone.utc).isoformat()


def uptime_s():
    with open("/proc/uptime") as f:
        return int(float(f.read().split()[0]))


def container_state(name):
    rc, out = run(["docker", "inspect", name])
    if rc != 0:
        return {"name": name, "exists": False}
    info = json.loads(out)[0]
    s = info.get("State", {})
    return {
        "name": name,
        "exists": True,
        "status": s.get("Status"),            # running / exited / created / restarting
        "running": s.get("Running", False),
        "exit_code": s.get("ExitCode"),
        "error": s.get("Error") or None,       # np. "address already in use"
        "started_at": s.get("StartedAt"),
        "finished_at": s.get("FinishedAt"),
        "health": (s.get("Health") or {}).get("Status"),
        "restart_count": info.get("RestartCount"),
    }


def backend_http():
    try:
        with urllib.request.urlopen("http://127.0.0.1:8001/version", timeout=5) as r:
            return {"ok": True, "version": json.loads(r.read()).get("version")}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def load_state():
    try:
        with open(STATE_FILE) as f:
            return json.load(f)
    except Exception:
        return {}


def save_state(st):
    os.makedirs(os.path.dirname(STATE_FILE), exist_ok=True)
    with open(STATE_FILE, "w") as f:
        json.dump(st, f)


def deploy_in_progress():
    try:
        return time.time() - os.path.getmtime(DEPLOY_LOCK) < DEPLOY_LOCK_MAX_AGE
    except OSError:
        return False


def main():
    now = time.time()
    up = uptime_s()
    _, docker_status = run(["systemctl", "is-active", "docker"])
    docker_ok = docker_status == "active"

    containers = [container_state(c) for c in CONTAINERS] if docker_ok else []

    http = backend_http()

    # ── samonaprawa ────────────────────────────────────────────────
    st = load_state()
    heal = st.get("last_heal")
    all_running = containers and all(c.get("running") for c in containers)
    if docker_ok and not all_running and not deploy_in_progress():
        if not heal or now - heal.get("ts", 0) >= HEAL_INTERVAL:
            rc, out = run(["docker", "compose", "--project-directory", APP_DIR, "up", "-d"],
                          timeout=180)
            heal = {"ts": now, "at": iso(now), "ok": rc == 0, "output": out[-1500:]}
            st["last_heal"] = heal
            save_state(st)
            containers = [container_state(c) for c in CONTAINERS]
            http = backend_http()

    # ── logi (do podglądu na ekranie logowania) ────────────────────
    logs = {}
    if docker_ok:
        for c in containers:
            if c["exists"]:
                _, out = run(["docker", "logs", "--tail", str(LOG_LINES), c["name"]])
                logs[c["name"]] = out[-4000:]

    disk = shutil.disk_usage("/")
    report = {
        "generated_at": iso(now),
        "hostname": os.uname().nodename,
        "uptime_s": up,
        "boot_time": iso(now - up),
        "docker": {"active": docker_ok, "status": docker_status},
        "containers": containers,
        "backend_http": http,
        "deploy_in_progress": deploy_in_progress(),
        "last_heal": heal,
        "disk": {"free_gb": round(disk.free / 1e9, 1),
                 "used_pct": round(100 * disk.used / disk.total)},
        "logs": logs,
    }

    tmp = OUT_FILE + ".tmp"
    with open(tmp, "w") as f:
        json.dump(report, f, ensure_ascii=False, indent=1)
    os.chmod(tmp, 0o644)
    os.replace(tmp, OUT_FILE)


if __name__ == "__main__":
    main()

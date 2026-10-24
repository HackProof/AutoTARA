"""FastAPI bridge between the active AutoTARA diagram and the local malsim."""

import asyncio
import json
import os
from pathlib import Path
import sys
import time
from uuid import UUID, uuid4

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse
import yaml

from schemas import SimulationRequest

ROOT = Path(__file__).resolve().parent
ARTIFACTS = {"scenario.yml", "model.yml", "language.json", "attackgraph.json", "result.json", "simulation.log"}


def write_scenario(directory: Path, data: SimulationRequest):
    directory.mkdir(parents=True)
    (directory / "logs").mkdir()
    (directory / "request.json").write_text(data.model_dump_json(), encoding="utf-8")
    (directory / "language.json").write_text(json.dumps(data.language_graph), encoding="utf-8")
    (directory / "model.yml").write_text(
        yaml.safe_dump(data.model, allow_unicode=True, sort_keys=False), encoding="utf-8"
    )
    scenario = {
        "lang_file": "./language.json",
        "model_file": "./model.yml",
        "agents": {
            "Attacker": {
                "type": "attacker",
                "entry_points": data.entry_points,
                "agent_class": data.attacker_type,
                "goals": data.goals,
                "config": {"action_ordering": "sorted", "seed": data.seed},
            }
        },
        "sim_settings": {"seed": data.seed, "ttc_mode": "DISABLED"},
    }
    text = yaml.safe_dump(scenario, allow_unicode=True, sort_keys=False)
    (directory / "scenario.yml").write_text(text, encoding="utf-8")
    return text


async def run_worker(directory: Path, request: Request, timeout: float):
    with (directory / "simulation.log").open("w", encoding="utf-8") as log:
        process = await asyncio.create_subprocess_exec(
            sys.executable, str(ROOT / "worker.py"), str(directory),
            cwd=directory, stdout=log, stderr=log,
        )
        waiter = asyncio.create_task(process.wait())
        deadline = time.monotonic() + timeout
        try:
            while not waiter.done():
                await asyncio.wait({waiter}, timeout=0.2)
                if await request.is_disconnected():
                    raise HTTPException(499, "Simulation cancelled.")
                if not waiter.done() and time.monotonic() >= deadline:
                    raise HTTPException(504, "Simulation exceeded the server time limit. Reduce the model or max_steps.")
            if process.returncode:
                error_file = directory / "error.json"
                detail = json.loads(error_file.read_text())["detail"] if error_file.exists() else "Simulation worker failed. Check simulation.log on the server."
                raise HTTPException(422, detail)
            return json.loads((directory / "result.json").read_text(encoding="utf-8"))
        finally:
            if process.returncode is None:
                process.kill()
            await waiter


def create_app(runs_dir=None, timeout=None, max_concurrent=2):
    application = FastAPI(title="AutoTARA Simulation Server", version="1.0.0")
    run_root = Path(runs_dir or os.environ.get("SIMULATION_RUNS_DIR", ROOT / "runs")).resolve()
    time_limit = float(timeout if timeout is not None else os.environ.get("SIMULATION_TIMEOUT_SECONDS", "120"))
    slots = asyncio.Semaphore(max_concurrent)

    @application.get("/api/simulations/health")
    async def health():
        return {"status": "ok", "attackerTypes": ["BreadthFirstAttacker", "DepthFirstAttacker"]}

    @application.post("/api/simulations")
    async def simulate(data: SimulationRequest, request: Request):
        if slots.locked():
            raise HTTPException(503, "All simulation workers are busy. Try again shortly.")
        async with slots:
            run_id = str(uuid4())
            directory = run_root / run_id
            scenario = write_scenario(directory, data)
            result = await run_worker(directory, request, time_limit)
            return {
                **result,
                "runId": run_id,
                "scenario": scenario,
                "artifacts": {name: f"/api/simulations/{run_id}/files/{name}" for name in sorted(ARTIFACTS)},
            }

    @application.get("/api/simulations/{run_id}/files/{filename}")
    async def artifact(run_id: UUID, filename: str):
        path = run_root / str(run_id) / filename
        if filename not in ARTIFACTS or not path.is_file():
            raise HTTPException(404, "Simulation artifact not found.")
        return FileResponse(path, filename=filename)

    return application


app = create_app()

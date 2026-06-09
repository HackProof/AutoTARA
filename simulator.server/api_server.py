from __future__ import annotations

import json
import hashlib
import logging
import os
import shutil
import subprocess
import sys
import uuid
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import Any

import yaml
from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

APP_DIR = Path(__file__).resolve().parent
MODULE_DIR = APP_DIR / "module" if (APP_DIR / "module" / "maltoolbox").exists() else APP_DIR
CORE_DIR = MODULE_DIR / "core" if (MODULE_DIR / "core").exists() else APP_DIR / "core"
EXPORT_PATHS_SCRIPT = CORE_DIR / "export_paths.py"
WORK_DIR = Path(os.environ.get("MALSIM_WORK_DIR", "/tmp/autotara/mal-simulator"))
WORK_DIR.mkdir(parents=True, exist_ok=True)

ALLOWED_ARTIFACTS = {
    "attackgraph.yml",
    "attack_paths.json",
    "attack_paths.pdf",
    "model.json",
    "langGraph.json",
    "simulation.log",
}


class SimulationStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class SimulationResponse(BaseModel):
    session_id: str
    status: SimulationStatus
    message: str
    created_at: str


class SimulationResult(BaseModel):
    session_id: str
    status: SimulationStatus
    created_at: str
    completed_at: str | None = None
    result: dict[str, Any] | None = None
    error: str | None = None
    attack_graph: dict[str, Any] | None = None


app = FastAPI(
    title="AutoTARA MAL Simulator API",
    description="MAL LangGraph based attack graph and attack path generation API.",
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

simulation_results: dict[str, dict[str, Any]] = {}


@app.get("/")
async def get_root():
    return {
        "name": "AutoTARA MAL Simulator API",
        "version": "2.0.0",
        "status": "running",
        "endpoints": {
            "POST /simulation/run-file": "Generate attack graph and attack paths",
            "GET /simulation/{session_id}": "Read a simulation result",
            "GET /simulation/{session_id}/status": "Read a simulation status",
            "GET /simulation/{session_id}/artifacts/{artifact_name}": "Download generated artifacts",
        },
    }


@app.get("/health")
async def get_health():
    return {"status": "healthy", "timestamp": datetime.now().isoformat()}


def now_iso() -> str:
    return datetime.now().isoformat()


def safe_upload_name(upload: UploadFile | None, default_name: str) -> str:
    if upload is None:
        return default_name
    suffix = Path(upload.filename or default_name).suffix
    stem = Path(default_name).stem
    return f"{stem}{suffix or Path(default_name).suffix}"


async def save_upload(upload: UploadFile, destination: Path) -> None:
    content = await upload.read()
    destination.write_bytes(content)


def build_command_env() -> dict[str, str]:
    env = os.environ.copy()
    existing_pythonpath = env.get("PYTHONPATH", "")
    paths = [str(MODULE_DIR), str(CORE_DIR), str(APP_DIR)]
    if existing_pythonpath:
        paths.append(existing_pythonpath)
    env["PYTHONPATH"] = os.pathsep.join(dict.fromkeys(paths))
    return env


def run_command(command: list[str], cwd: Path, log_file: Path) -> None:
    logger.info("Running command in %s: %s", cwd, " ".join(command))
    completed = subprocess.run(
        command,
        cwd=str(cwd),
        env=build_command_env(),
        capture_output=True,
        text=True,
        check=False,
    )

    with log_file.open("a", encoding="utf-8") as log:
        log.write(f"$ {' '.join(command)}\n")
        if completed.stdout:
            log.write("\n[stdout]\n")
            log.write(completed.stdout)
            log.write("\n")
        if completed.stderr:
            log.write("\n[stderr]\n")
            log.write(completed.stderr)
            log.write("\n")
        log.write(f"\n[exit_code] {completed.returncode}\n\n")

    if completed.returncode != 0:
        detail = completed.stderr.strip() or completed.stdout.strip() or "Command failed"
        raise RuntimeError(detail)


def load_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def file_digest(path: Path) -> dict[str, Any]:
    content = path.read_bytes()
    return {
        "bytes": len(content),
        "sha256": hashlib.sha256(content).hexdigest(),
    }


def load_yaml(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    return yaml.safe_load(path.read_text(encoding="utf-8")) or {}


def append_log(log_file: Path, message: str) -> None:
    with log_file.open("a", encoding="utf-8") as log:
        log.write(message.rstrip())
        log.write("\n")


def normalize_association_ids(associated_assets: Any, assets: dict[str, Any]) -> list[str]:
    if isinstance(associated_assets, dict):
        return [str(asset_id) for asset_id in associated_assets.keys()]
    if isinstance(associated_assets, list):
        return [str(asset_id) for asset_id in associated_assets]
    return []


def sanitize_model_associations(model_path: Path, lang_graph_path: Path, log_file: Path) -> None:
    """Trim invalid or over-cardinality associations before maltoolbox loads the model."""
    try:
        from maltoolbox.language.languagegraph import LanguageGraph
    except Exception as exc:
        append_log(log_file, f"[sanitize] Skipped: failed to import maltoolbox LanguageGraph: {exc}")
        return

    try:
        model_data = load_json(model_path)
        lang_graph = LanguageGraph.load_from_file(str(lang_graph_path))
    except Exception as exc:
        append_log(log_file, f"[sanitize] Skipped: failed to load model or LangGraph: {exc}")
        return

    assets = model_data.get("assets") or {}
    if not isinstance(assets, dict):
        return

    changed = False
    messages: list[str] = []

    for asset_id, asset_dict in assets.items():
        if not isinstance(asset_dict, dict):
            continue

        asset_type = asset_dict.get("type")
        lg_asset = lang_graph.assets.get(asset_type)
        associations = asset_dict.get("associated_assets") or {}
        if not lg_asset or not isinstance(associations, dict):
            continue

        for fieldname in list(associations.keys()):
            association = lg_asset.associations.get(fieldname)
            if association is None:
                messages.append(f"removed unknown field {asset_dict.get('name')}:{fieldname}")
                del associations[fieldname]
                changed = True
                continue

            field = association.get_field(fieldname)
            max_count = field.maximum or None
            kept_ids: list[str] = []
            original_ids = normalize_association_ids(associations[fieldname], assets)

            for associated_id in original_ids:
                associated_asset = assets.get(str(associated_id))
                if not isinstance(associated_asset, dict):
                    changed = True
                    messages.append(f"removed missing associated asset id {associated_id} from {asset_dict.get('name')}:{fieldname}")
                    continue

                target_lg_asset = lang_graph.assets.get(associated_asset.get("type"))
                if target_lg_asset is None or not target_lg_asset.is_subasset_of(field.asset):
                    changed = True
                    messages.append(
                        f"removed invalid associated asset {associated_asset.get('name')} "
                        f"from {asset_dict.get('name')}:{fieldname}"
                    )
                    continue

                if max_count is not None and len(kept_ids) >= max_count:
                    changed = True
                    messages.append(
                        f"trimmed {asset_dict.get('name')}:{fieldname} to max {max_count}; "
                        f"skipped {associated_asset.get('name')}"
                    )
                    continue

                kept_ids.append(str(associated_id))

            if len(kept_ids) != len(original_ids):
                changed = True

            if kept_ids:
                associations[fieldname] = {
                    associated_id: assets[associated_id].get("name", associated_id)
                    for associated_id in kept_ids
                }
            else:
                del associations[fieldname]

    if changed:
        model_path.write_text(json.dumps(model_data, indent=2, ensure_ascii=False), encoding="utf-8")
        append_log(log_file, "[sanitize] Model associations normalized:")
        for message in messages:
            append_log(log_file, f"[sanitize] - {message}")


def split_step(full_step: str) -> dict[str, str]:
    text = str(full_step or "").strip()
    if ":" not in text:
        return {"assetName": text, "attackStep": "", "fullStep": text}
    asset_name, attack_step = text.split(":", 1)
    return {
        "assetName": asset_name,
        "attackStep": attack_step,
        "fullStep": text,
    }


def summarize_attack_graph(attackgraph_path: Path) -> dict[str, Any]:
    data = load_yaml(attackgraph_path)
    attack_steps = data.get("attack_steps") or {}
    nodes = []
    edges = []

    for full_name, step_data in attack_steps.items():
        node_id = step_data.get("id")
        nodes.append(
            {
                "id": node_id,
                "fullName": full_name,
                "assetName": step_data.get("asset") or split_step(full_name)["assetName"],
                "attackStep": split_step(full_name)["attackStep"],
                "type": step_data.get("type"),
                "tags": step_data.get("tags") or [],
            }
        )
        for child_id in (step_data.get("children") or {}).keys():
            edges.append({"from": node_id, "to": int(child_id)})

    return {
        "artifact": "attackgraph.yml",
        "nodeCount": len(nodes),
        "edgeCount": len(edges),
        "nodes": nodes[:500],
        "edges": edges[:1000],
        "truncated": len(nodes) > 500 or len(edges) > 1000,
    }


def normalize_linear_attack_paths(path_result: dict[str, Any]) -> list[dict[str, Any]]:
    attack_path = path_result.get("AttackPath") or {}
    paths = []

    for key, value in sorted(attack_path.items()):
        if not str(key).startswith("path") or not isinstance(value, dict):
            continue

        ordered_steps = []
        for step_index, step_value in sorted(
            value.items(),
            key=lambda item: int(item[0]) if str(item[0]).isdigit() else 999999,
        ):
            if not isinstance(step_value, dict):
                continue
            asset_name = step_value.get("assetName") or ""
            attack_step = step_value.get("attackStep") or ""
            ordered_steps.append(
                {
                    "step": int(step_index) if str(step_index).isdigit() else len(ordered_steps) + 1,
                    "assetType": step_value.get("assetType") or "",
                    "assetName": asset_name,
                    "attackStep": attack_step,
                    "fullStep": f"{asset_name}:{attack_step}" if attack_step else asset_name,
                }
            )

        paths.append(
            {
                "key": str(key),
                "label": f"Attack Path {len(paths) + 1}",
                "steps": ordered_steps,
            }
        )

    return paths


def build_shortest_paths_compat(entry: str, target: str, paths: list[dict[str, Any]]) -> dict[str, Any]:
    if not paths:
        return {"available": False, "error": "No attack paths found", "agents": {}}

    full_path = [
        {
            "id": index + 1,
            "name": step["attackStep"],
            "full_name": step["fullStep"],
            "type": "or",
            "step": index + 1,
        }
        for index, step in enumerate(paths[0]["steps"])
    ]

    return {
        "available": True,
        "error": None,
        "ttc_mode": "MALTOOLBOX_EXPORT",
        "agents": {
            "Attacker": {
                "entry_points": [
                    {
                        "id": 1,
                        "name": split_step(entry)["attackStep"],
                        "full_name": entry,
                        "type": "or",
                    }
                ],
                "goals": {
                    target: {
                        "path_found": True,
                        "goal": {
                            "id": len(full_path),
                            "name": split_step(target)["attackStep"],
                            "full_name": target,
                            "type": "or",
                        },
                        "path": full_path[1:] if len(full_path) > 1 else full_path,
                        "full_path": full_path,
                        "total_ttc": None,
                    }
                },
            }
        },
    }


def build_legacy_attack_paths(paths: list[dict[str, Any]]) -> dict[str, dict[str, list[list[dict[str, Any]]]]]:
    return {
        "Attacker": {
            "Target": [
                [
                    {
                        "id": step["step"],
                        "name": step["attackStep"],
                        "full_name": step["fullStep"],
                        "type": "or",
                        "assetName": step["assetName"],
                        "attackStep": step["attackStep"],
                    }
                    for step in path["steps"]
                ]
                for path in paths
            ]
        }
    }


def run_attack_path_task(
    session_id: str,
    model_path: Path,
    lang_graph_path: Path,
    entry: str,
    target: str,
) -> None:
    session_dir = WORK_DIR / session_id
    log_file = session_dir / "simulation.log"
    attackgraph_path = session_dir / "logs" / "attackgraph.yml"
    attack_paths_json = session_dir / "attack_paths.json"
    attack_paths_pdf = session_dir / "attack_paths.pdf"

    try:
        simulation_results[session_id]["status"] = SimulationStatus.RUNNING
        sanitize_model_associations(model_path, lang_graph_path, log_file)

        run_command(
            [
                sys.executable,
                "-m",
                "maltoolbox",
                "generate-attack-graph",
                str(model_path),
                str(lang_graph_path),
            ],
            cwd=session_dir,
            log_file=log_file,
        )

        if not attackgraph_path.exists():
            raise RuntimeError(f"attackgraph.yml was not generated at {attackgraph_path}")

        run_command(
            [
                sys.executable,
                str(EXPORT_PATHS_SCRIPT),
                str(attackgraph_path),
                str(model_path),
                "--entry",
                entry,
                "--target",
                target,
                "--output",
                str(attack_paths_json),
                "--graphviz-output",
                str(attack_paths_pdf),
                "--graphviz-format",
                "pdf",
            ],
            cwd=session_dir,
            log_file=log_file,
        )

        path_result = load_json(attack_paths_json)
        paths = normalize_linear_attack_paths(path_result)
        attack_graph = summarize_attack_graph(attackgraph_path)
        attack_path_found = len(paths) > 0

        result = {
            "attack_path_found": attack_path_found,
            "attack_paths": build_legacy_attack_paths(paths),
            "attack_paths_count": {"Attacker": {"Target": len(paths)}},
            "attack_trees": {},
            "shortest_paths": build_shortest_paths_compat(entry, target, paths),
            "attack_graph": attack_graph,
            "attack_path": {
                "entry": entry,
                "target": target,
                "paths": paths,
                "raw": path_result,
                "jsonArtifact": "attack_paths.json",
                "pdfArtifact": "attack_paths.pdf" if attack_paths_pdf.exists() else None,
            },
            "artifacts": {
                "attackGraph": "attackgraph.yml",
                "attackPathJson": "attack_paths.json",
                "attackPathPdf": "attack_paths.pdf" if attack_paths_pdf.exists() else None,
            },
        }

        simulation_results[session_id].update(
            {
                "status": SimulationStatus.COMPLETED,
                "completed_at": now_iso(),
                "result": result,
                "attack_graph": attack_graph,
            }
        )
        logger.info("Simulation completed: %s", session_id)
    except Exception as exc:
        logger.exception("Simulation failed: %s", session_id)
        simulation_results[session_id].update(
            {
                "status": SimulationStatus.FAILED,
                "completed_at": now_iso(),
                "error": str(exc),
            }
        )


async def prepare_uploaded_run(
    session_id: str,
    model_file: UploadFile,
    lang_graph_file: UploadFile | None,
    lang_file: UploadFile | None,
    entry: str,
    target: str,
) -> tuple[Path, Path]:
    if not entry:
        raise HTTPException(status_code=400, detail="entryPoint is required.")
    if not target:
        raise HTTPException(status_code=400, detail="goal is required.")

    language_upload = lang_graph_file or lang_file
    if language_upload is None:
        raise HTTPException(status_code=400, detail="langGraph or lang_file is required.")

    session_dir = WORK_DIR / session_id
    session_dir.mkdir(parents=True, exist_ok=True)

    model_path = session_dir / "model.json"
    lang_graph_path = session_dir / safe_upload_name(language_upload, "langGraph.json")
    if lang_graph_path.name != "langGraph.json" and lang_graph_path.suffix.lower() == ".json":
        lang_graph_path = session_dir / "langGraph.json"

    await save_upload(model_file, model_path)
    await save_upload(language_upload, lang_graph_path)

    return model_path, lang_graph_path


@app.post("/simulation/run-file", response_model=SimulationResponse)
async def run_simulation_file(
    background_tasks: BackgroundTasks,
    entryPoint: str = Form(""),
    goal: str = Form(""),
    model_file: UploadFile = File(...),
    lang_graph_file: UploadFile | None = File(None),
    langGraph: UploadFile | None = File(None),
    lang_file: UploadFile | None = File(None),
):
    session_id = str(uuid.uuid4())
    created_at = now_iso()
    language_upload = lang_graph_file or langGraph or lang_file
    model_path, lang_graph_path = await prepare_uploaded_run(
        session_id,
        model_file,
        language_upload,
        None,
        entryPoint,
        goal,
    )

    simulation_results[session_id] = {
        "session_id": session_id,
        "status": SimulationStatus.PENDING,
        "created_at": created_at,
        "completed_at": None,
        "result": None,
        "error": None,
        "attack_graph": None,
        "entry": entryPoint,
        "target": goal,
        "session_dir": str(WORK_DIR / session_id),
        "uploads": {
            "model": file_digest(model_path),
            "langGraph": file_digest(lang_graph_path),
            "langGraphOriginalName": language_upload.filename if language_upload else None,
        },
    }

    append_log(
        WORK_DIR / session_id / "simulation.log",
        (
            f"[upload] langGraph original={language_upload.filename if language_upload else ''} "
            f"saved={lang_graph_path.name} sha256={simulation_results[session_id]['uploads']['langGraph']['sha256']} "
            f"bytes={simulation_results[session_id]['uploads']['langGraph']['bytes']}"
        ),
    )

    background_tasks.add_task(
        run_attack_path_task,
        session_id,
        model_path,
        lang_graph_path,
        entryPoint,
        goal,
    )

    return SimulationResponse(
        session_id=session_id,
        status=SimulationStatus.PENDING,
        message="Simulation queued.",
        created_at=created_at,
    )


@app.post("/simulation/shortest_path")
async def calculate_shortest_path(
    background_tasks: BackgroundTasks,
    entryPoint: str = Form(""),
    goal: str = Form(""),
    model_file: UploadFile = File(...),
    lang_graph_file: UploadFile | None = File(None),
    langGraph: UploadFile | None = File(None),
    lang_file: UploadFile | None = File(None),
):
    response = await run_simulation_file(
        background_tasks,
        entryPoint=entryPoint,
        goal=goal,
        model_file=model_file,
        lang_graph_file=lang_graph_file,
        langGraph=langGraph,
        lang_file=lang_file,
    )
    return response.model_dump()


@app.post("/simulation/run", response_model=SimulationResponse)
async def run_simulation():
    raise HTTPException(status_code=400, detail="Use /simulation/run-file with model and LangGraph uploads.")


@app.get("/simulation/{session_id}", response_model=SimulationResult)
async def get_simulation(session_id: str):
    result = simulation_results.get(session_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Simulation not found.")
    return SimulationResult(**result)


@app.get("/simulation/{session_id}/status")
async def get_simulation_status(session_id: str):
    result = simulation_results.get(session_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Simulation not found.")
    return {
        "session_id": session_id,
        "status": result["status"],
        "created_at": result.get("created_at"),
        "completed_at": result.get("completed_at"),
        "error": result.get("error"),
    }


@app.get("/simulation/{session_id}/artifacts/{artifact_name}")
async def get_simulation_artifact(session_id: str, artifact_name: str):
    if artifact_name not in ALLOWED_ARTIFACTS:
        raise HTTPException(status_code=404, detail="Artifact not found.")
    if session_id not in simulation_results:
        raise HTTPException(status_code=404, detail="Simulation not found.")

    session_dir = WORK_DIR / session_id
    candidates = [
        session_dir / artifact_name,
        session_dir / "logs" / artifact_name,
    ]
    artifact_path = next((path for path in candidates if path.exists()), None)
    if artifact_path is None:
        raise HTTPException(status_code=404, detail="Artifact not found.")

    media_type = "application/octet-stream"
    if artifact_path.suffix == ".json":
        media_type = "application/json"
    elif artifact_path.suffix in {".yml", ".yaml"}:
        media_type = "application/x-yaml"
    elif artifact_path.suffix == ".pdf":
        media_type = "application/pdf"

    return FileResponse(
        artifact_path,
        media_type=media_type,
        filename=artifact_path.name,
    )


@app.get("/simulations")
async def list_simulations():
    return {
        "total": len(simulation_results),
        "simulations": [
            {
                "session_id": session_id,
                "status": data["status"],
                "created_at": data.get("created_at"),
                "completed_at": data.get("completed_at"),
            }
            for session_id, data in simulation_results.items()
        ],
    }


@app.delete("/simulation/{session_id}")
async def delete_simulation(session_id: str):
    if session_id not in simulation_results:
        raise HTTPException(status_code=404, detail="Simulation not found.")

    session_dir = WORK_DIR / session_id
    if session_dir.exists():
        shutil.rmtree(session_dir)
    del simulation_results[session_id]

    return {"message": f"Simulation {session_id} deleted."}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("api_server:app", host="0.0.0.0", port=8000, reload=True)

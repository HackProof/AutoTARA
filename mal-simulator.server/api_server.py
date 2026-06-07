from __future__ import annotations
import os
import json
import uuid
import logging
from datetime import datetime
from pathlib import Path
from typing import Optional, Dict, Any
from enum import Enum

from fastapi import FastAPI, HTTPException, UploadFile, File, BackgroundTasks, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import yaml
import uvicorn

from malsim.mal_simulator import MalSimulator, TTCMode
from malsim.policies.utils.path_finding import get_shortest_path_to
from malsim.scenario.scenario import Scenario

# 로깅 설정
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# FastAPI 앱 생성
app = FastAPI(
    title="MAL Simulator API",
    description="Meta Attack Language 시뮬레이션을 위한 REST API",
    version="1.0.0"
)

# CORS 설정 (필요시 origins 제한)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 시뮬레이션 결과 저장소 (실제 운영 환경에서는 DB 사용 권장)
simulation_results: Dict[str, Dict[str, Any]] = {}

# 시뮬레이션 작업 디렉토리
WORK_DIR = Path(os.environ.get("MALSIM_WORK_DIR", "/tmp/autotara/mal-simulator"))
WORK_DIR.mkdir(exist_ok=True, parents=True)


# === Pydantic 모델 정의 ===

class SimulationStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class SimulationRequest(BaseModel):
    """시뮬레이션 요청 모델"""
    scenario_yaml: str = Field(..., description="시나리오 YAML 내용")
    seed: Optional[int] = Field(None, description="시뮬레이션 시드값")
    ttc_mode: int = Field(3, description="TTC 모드 (0=EFFORT_BASED_PER_STEP_SAMPLE, 1=PER_STEP_SAMPLE, 2=PRE_SAMPLE, 3=EXPECTED_VALUE, 4=DISABLED)")
    
    class Config:
        json_schema_extra = {
            "example": {
                "scenario_yaml": "lang_file: ./path/to/lang.mar\nmodel_file: ./path/to/model.yml\nagents:\n  attacker1:\n    ...",
                "seed": 42,
                "ttc_mode": 3
            }
        }


class SimulationResponse(BaseModel):
    """시뮬레이션 응답 모델"""
    session_id: str
    status: SimulationStatus
    message: str
    created_at: str


class SimulationResult(BaseModel):
    """시뮬레이션 결과 모델"""
    session_id: str
    status: SimulationStatus
    created_at: str
    completed_at: Optional[str] = None
    result: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    attack_graph: Optional[Dict[str, Any]] = None


# === 헬퍼 함수 ===

def save_scenario_file(session_id: str, scenario_content: str) -> Path:
    """시나리오 파일을 저장"""
    session_dir = WORK_DIR / session_id
    session_dir.mkdir(exist_ok=True)
    
    scenario_file = session_dir / "scenario.yml"
    with open(scenario_file, 'w', encoding='utf-8') as f:
        f.write(scenario_content)
    
    return scenario_file


def parse_int_field(value: Any, field_name: str, default: Optional[int] = None) -> Optional[int]:
    """폼/JSON 입력에서 정수 필드를 안전하게 파싱"""
    if value is None or value == "":
        return default

    try:
        return int(value)
    except (TypeError, ValueError) as err:
        raise ValueError(f"{field_name} must be an integer.") from err


def build_scenario_yaml(
    entry_point: str,
    goal: str,
    lang_file_name: str,
    model_file_name: str,
    attacker_name: str = "Attacker"
) -> str:
    """entry/goal 기반으로 shortest path 계산용 scenario.yml 생성"""
    scenario = {
        "lang_file": lang_file_name,
        "model_file": model_file_name,
        "agents": {
            attacker_name: {
                "type": "attacker",
                "entry_points": [entry_point],
                "goals": [goal],
                "agent_class": "BreadthFirstAttacker"
            },
            "Defender": {
                "type": "defender",
                "agent_class": "PassiveAgent"
            }
        }
    }
    return yaml.safe_dump(scenario, allow_unicode=True, sort_keys=False)


def get_upload_from_form(value: Any) -> Optional[Any]:
    """multipart form 값이 업로드 파일이면 반환"""
    if hasattr(value, "filename") and hasattr(value, "read"):
        return value
    return None


async def save_uploaded_file(session_dir: Path, upload: Any, default_name: str) -> str:
    """업로드 파일을 세션 디렉토리에 저장하고 파일명을 반환"""
    filename = Path(getattr(upload, "filename", "") or default_name).name
    file_path = session_dir / filename

    content = await upload.read()
    with open(file_path, "wb") as f:
        f.write(content)

    return filename


async def prepare_shortest_path_request(
    session_id: str,
    request: Request
) -> tuple[Path, Optional[int], int]:
    """
    shortest_path 요청을 표준화합니다.

    지원 형식:
    1. JSON body: {scenario_yaml, seed, ttc_mode}
    2. multipart/form-data:
       - scenario_file + optional lang_file/model_file
       - entryPoint/goal + mar/model
    """
    content_type = request.headers.get("content-type", "")

    if "multipart/form-data" in content_type:
        form = await request.form()
        seed = parse_int_field(form.get("seed"), "seed", None)
        ttc_mode = parse_int_field(
            form.get("ttc_mode", form.get("ttcMode")),
            "ttc_mode",
            3
        )

        session_dir = WORK_DIR / session_id
        session_dir.mkdir(exist_ok=True)

        scenario_upload = get_upload_from_form(form.get("scenario_file"))
        lang_upload = get_upload_from_form(form.get("lang_file")) or get_upload_from_form(form.get("mar"))
        model_upload = get_upload_from_form(form.get("model_file")) or get_upload_from_form(form.get("model"))

        if scenario_upload:
            scenario_yaml = (await scenario_upload.read()).decode("utf-8")
            scenario_dict = yaml.safe_load(scenario_yaml)
            if not isinstance(scenario_dict, dict):
                raise ValueError("scenario_file must contain a YAML object.")

            if lang_upload:
                lang_filename = await save_uploaded_file(session_dir, lang_upload, "language.mar")
                scenario_dict["lang_file"] = lang_filename

            if model_upload:
                model_filename = await save_uploaded_file(session_dir, model_upload, "model.json")
                scenario_dict["model_file"] = model_filename

            scenario_path = session_dir / "scenario.yml"
            with open(scenario_path, "w", encoding="utf-8") as f:
                yaml.safe_dump(scenario_dict, f, allow_unicode=True, sort_keys=False)

            return scenario_path, seed, ttc_mode

        entry_point = form.get("entryPoint") or form.get("entry_point")
        goal = form.get("goal")
        if entry_point and goal:
            if not lang_upload:
                raise ValueError("mar or lang_file is required for multipart shortest_path requests.")
            if not model_upload:
                raise ValueError("model or model_file is required for multipart shortest_path requests.")

            lang_filename = await save_uploaded_file(session_dir, lang_upload, "language.mar")
            model_filename = await save_uploaded_file(session_dir, model_upload, "model.json")
            scenario_yaml = build_scenario_yaml(entry_point, goal, lang_filename, model_filename)
            scenario_path = save_scenario_file(session_id, scenario_yaml)
            return scenario_path, seed, ttc_mode

        raise ValueError(
            "Unsupported multipart payload. Use scenario_file or entryPoint/goal with mar/model."
        )

    try:
        payload = await request.json()
    except Exception as err:
        raise ValueError(
            "Unsupported request body. Use JSON {scenario_yaml, seed, ttc_mode} "
            "or multipart/form-data."
        ) from err

    simulation_request = SimulationRequest(**payload)
    scenario_file = save_scenario_file(session_id, simulation_request.scenario_yaml)
    return scenario_file, simulation_request.seed, simulation_request.ttc_mode


def serialize_attack_graph_node(node, step: Optional[int] = None, ttc: Optional[float] = None) -> Dict[str, Any]:
    """AttackGraphNode를 API 응답에 넣을 수 있는 dict로 변환"""
    data = {
        "id": node.id,
        "name": node.name,
        "full_name": node.full_name,
        "type": str(node.type),
    }

    if step is not None:
        data["step"] = step
    if ttc is not None:
        data["ttc"] = float(ttc)

    return data


def get_shortest_path(sim: MalSimulator) -> Dict[str, Any]:
    """
    각 attacker의 entry point에서 goal까지 TTC 기준 shortest path를 계산합니다.

    malsim의 get_shortest_path_to는 AttackGraphNode 객체와 TTC 값을 필요로 하므로,
    시뮬레이터 초기화 이후 sim.agent_settings와 sim.sim_state.graph_state.ttc_values를 사용합니다.
    """
    attack_graph = sim.sim_state.attack_graph
    ttc_values = sim.sim_state.graph_state.ttc_values

    if not ttc_values:
        return {
            "available": False,
            "error": "TTC values are empty. Use TTCMode.PRE_SAMPLE or TTCMode.EXPECTED_VALUE to calculate shortest paths.",
            "ttc_mode": getattr(sim.sim_state.settings.ttc_mode, "name", str(sim.sim_state.settings.ttc_mode)),
            "agents": {}
        }

    shortest_paths = {
        "available": True,
        "error": None,
        "ttc_mode": getattr(sim.sim_state.settings.ttc_mode, "name", str(sim.sim_state.settings.ttc_mode)),
        "agents": {}
    }

    for agent_name, agent_settings in sim.agent_settings.items():
        goals = list(getattr(agent_settings, "goals", None) or [])
        entry_nodes = list(getattr(agent_settings, "entry_points", None) or [])

        if not goals:
            continue

        agent_result = {
            "entry_points": [
                serialize_attack_graph_node(node, ttc=ttc_values.get(node))
                for node in entry_nodes
            ],
            "goals": {}
        }

        for goal_node in goals:
            try:
                path = get_shortest_path_to(
                    attack_graph,
                    entry_nodes,
                    goal_node,
                    ttc_values
                )

                full_path = []
                seen_node_names = set()
                for node in [*entry_nodes, *path]:
                    if node.full_name in seen_node_names:
                        continue
                    seen_node_names.add(node.full_name)
                    full_path.append(node)

                total_ttc = sum(float(ttc_values.get(node, 0)) for node in path)

                agent_result["goals"][goal_node.full_name] = {
                    "path_found": bool(path) or goal_node in entry_nodes,
                    "goal": serialize_attack_graph_node(goal_node, ttc=ttc_values.get(goal_node)),
                    "path": [
                        serialize_attack_graph_node(node, step=idx + 1, ttc=ttc_values.get(node))
                        for idx, node in enumerate(path)
                    ],
                    "full_path": [
                        serialize_attack_graph_node(node, step=idx + 1, ttc=ttc_values.get(node))
                        for idx, node in enumerate(full_path)
                    ],
                    "total_ttc": total_ttc,
                }
            except Exception as err:
                logger.warning(f"[ShortestPath] {agent_name} -> {goal_node.full_name} 계산 실패: {err}")
                agent_result["goals"][goal_node.full_name] = {
                    "path_found": False,
                    "goal": serialize_attack_graph_node(goal_node, ttc=ttc_values.get(goal_node)),
                    "path": [],
                    "full_path": [],
                    "total_ttc": None,
                    "error": str(err),
                }

        shortest_paths["agents"][agent_name] = agent_result

    return shortest_paths


def apply_simulation_settings(scenario: Scenario, seed: Optional[int], ttc_mode: int) -> None:
    """요청으로 받은 시뮬레이션 설정을 Scenario 객체에 반영"""
    scenario.sim_settings.seed = seed
    scenario.sim_settings.ttc_mode = TTCMode(ttc_mode)
    scenario.sim_settings.attack_surface.skip_unnecessary = False


def get_shortest_path_with_fallback(
    scenario_file: Path,
    scenario: Scenario,
    sim: MalSimulator,
    seed: Optional[int]
) -> Dict[str, Any]:
    """TTC 값이 없는 모드인 경우 shortest path 계산만 EXPECTED_VALUE로 재시도"""
    shortest_path_result = get_shortest_path(sim)
    if not shortest_path_result.get("available") and scenario.sim_settings.ttc_mode != TTCMode.EXPECTED_VALUE:
        logger.info("TTC 값이 없어 EXPECTED_VALUE 모드로 shortest path만 재계산합니다.")
        shortest_path_scenario = Scenario.load_from_file(str(scenario_file))
        apply_simulation_settings(shortest_path_scenario, seed, TTCMode.EXPECTED_VALUE.value)
        shortest_path_sim = MalSimulator.from_scenario(
            shortest_path_scenario,
            send_to_api=False
        )
        shortest_path_result = get_shortest_path(shortest_path_sim)
        shortest_path_result["fallback_from_ttc_mode"] = scenario.sim_settings.ttc_mode.name

    return shortest_path_result


def calculate_shortest_path_from_file(scenario_file: Path, seed: Optional[int], ttc_mode: int) -> Dict[str, Any]:
    """시나리오 파일에서 shortest path만 계산"""
    logger.info(f"Shortest path 시나리오 로드: {scenario_file}")
    scenario = Scenario.load_from_file(str(scenario_file))
    apply_simulation_settings(scenario, seed, ttc_mode)

    logger.info(f"Shortest path 시뮬레이터 설정: seed={seed}, ttc_mode={ttc_mode}")
    sim = MalSimulator.from_scenario(
        scenario,
        send_to_api=False
    )

    shortest_path_result = get_shortest_path_with_fallback(scenario_file, scenario, sim, seed)
    logger.info(f"Shortest path 계산 완료: available={shortest_path_result.get('available')}")
    return shortest_path_result


def run_simulation_task(session_id: str, scenario_file: Path, seed: Optional[int], ttc_mode: int):
    """백그라운드에서 시뮬레이션 실행"""
    # 세션별 로그 파일 설정
    session_dir = WORK_DIR / session_id
    session_dir.mkdir(exist_ok=True, parents=True)
    log_file = session_dir / "simulation.log"
    
    # 파일 핸들러 생성
    file_handler = logging.FileHandler(log_file, encoding='utf-8')
    file_handler.setLevel(logging.INFO)
    file_formatter = logging.Formatter(
        '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )
    file_handler.setFormatter(file_formatter)
    
    # 루트 로거에 핸들러 추가
    root_logger = logging.getLogger()
    root_logger.addHandler(file_handler)
    
    try:
        logger.info(f"시뮬레이션 시작: {session_id}")
        logger.info(f"로그 파일: {log_file}")
        simulation_results[session_id]["status"] = SimulationStatus.RUNNING
        
        # 시나리오 로드
        logger.info(f"시나리오 로드: {scenario_file}")
        scenario = Scenario.load_from_file(str(scenario_file))
        
        # 시뮬레이터 설정
        apply_simulation_settings(scenario, seed, ttc_mode)
        logger.info(f"시뮬레이터 설정: seed={seed}, ttc_mode={ttc_mode}")
        
        # 시뮬레이터 생성
        logger.info("시뮬레이터 생성 중...")
        sim = MalSimulator.from_scenario(
            scenario,
            send_to_api=False
        )

        # shortest path는 초기 entry point 기준으로 계산해야 하므로 시뮬레이션 실행 전에 수행
        logger.info("Shortest path 계산 중...")
        shortest_path_result = get_shortest_path_with_fallback(scenario_file, scenario, sim, seed)
        logger.info(f"Shortest path 계산 완료: available={shortest_path_result.get('available')}")
        
        # 공격 그래프 저장
        attack_graph_file = WORK_DIR / session_id / "attack_graph.json"
        sim.sim_state.attack_graph.save_to_file(str(attack_graph_file))
        logger.info(f"공격 그래프 저장: {attack_graph_file}")
        
        # 시뮬레이션 실행
        logger.info("시뮬레이션 실행 시작...")
        from malsim.mal_simulator import run_simulation
        run_simulation(sim)
        logger.info("시뮬레이션 실행 완료")
        
        # 결과 수집
        logger.info("결과 수집 중...")
        # sim.recording의 AttackGraphNode 객체를 JSON 직렬화 가능한 형태로 변환
        iterations_serialized = {}
        for iteration, agents_data in sim.recording.items():
            iterations_serialized[str(iteration)] = {}
            for agent_name, nodes in agents_data.items():
                iterations_serialized[str(iteration)][agent_name] = [
                    {
                        "id": node.id,
                        "name": node.name,
                        "full_name": node.full_name,
                        "type": node.type,
                    }
                    for node in nodes
                ]
        
        # 침해된 노드의 full_name 집합 생성
        compromised_node_names = {node.full_name for node in sim.compromised_nodes}
        compromised_nodes_dict = {node.full_name: node for node in sim.compromised_nodes}
        
        # 공격 목표 달성 여부 확인 및 공격 경로 추적
        goals_status = {}
        attack_path_found = True  # 전체 공격 경로 발견 여부
        attack_paths = {}  # 각 목표까지의 공격 경로
        attack_trees = {}  # 각 목표까지의 Attack Tree
        
        def trace_all_attack_paths_from_graph(target_full_name, entry_points, attack_graph_file, max_paths=200, max_depth=50):
            """
            공격 그래프 파일을 사용하여 entry point부터 목표까지의 모든 공격 경로를 추출합니다.
            DFS를 사용하여 모든 경로를 탐색합니다.

            Args:
                target_full_name: 목표 노드의 full_name
                entry_points: 공격 시작점 full_name 리스트
                attack_graph_file: attack_graph.json 파일 경로
                max_paths: 최대 경로 수 (기본값 200)
                max_depth: 최대 탐색 깊이 (기본값 50)

            Returns:
                list[list[dict]]: 발견된 모든 경로 (각 경로는 노드 정보 객체 리스트 {id, name, full_name, type})
            """
            import json as _json

            # 공격 그래프 파일 로드
            try:
                with open(attack_graph_file, 'r', encoding='utf-8') as _f:
                    _ag = _json.load(_f)
            except Exception as e:
                logger.warning(f"공격 그래프 파일 로드 실패: {e}")
                return []

            steps = _ag.get('attack_steps', {})
            if not steps:
                logger.warning("attack_graph.json에 'attack_steps' 키가 없습니다.")
                return []

            # children 관계 구성 (full_name -> [child_full_name, ...])
            children_map = {}
            for name, node in steps.items():
                children_map[name] = list(node.get('children', {}).values())

            all_paths = []

            def _dfs(current, goal, visited, path):
                if len(all_paths) >= max_paths:
                    return
                if len(path) > max_depth:
                    return
                if current == goal:
                    # 노드 정보를 포함한 객체 리스트로 변환
                    path_objs = []
                    for node_name in path:
                        node_data = steps.get(node_name, {})
                        path_objs.append({
                            "id": node_data.get("id"),
                            "name": node_data.get("name"),
                            "full_name": node_name,
                            "type": node_data.get("type"),
                        })
                    all_paths.append(path_objs)
                    return
                for child in children_map.get(current, []):
                    if child not in visited:
                        visited.add(child)
                        path.append(child)
                        _dfs(child, goal, visited, path)
                        path.pop()
                        visited.remove(child)

            for entry_point in entry_points:
                if entry_point not in steps:
                    logger.warning(f"Entry point '{entry_point}'가 공격 그래프에 없습니다.")
                    continue
                if target_full_name not in steps:
                    logger.warning(f"목표 '{target_full_name}'가 공격 그래프에 없습니다.")
                    continue
                _dfs(entry_point, target_full_name, {entry_point}, [entry_point])

            return all_paths

        def build_attack_tree(target_full_name, entry_points, attack_graph_file):
            """
            공격 그래프에서 entry_point -> goal 사이의 도달 가능한 노드만 추려
            Attack Tree (DAG) 구조로 반환합니다.

            알고리즘:
              1. Forward pass: entry_point에서 BFS로 도달 가능한 노드 집합 계산
              2. Backward pass: goal에서 역방향 BFS로 goal에 기여하는 노드 집합 계산
              3. 두 집합의 교집합 = 실제 공격 경로에 포함되는 노드들
              4. Iterative BFS로 flat DAG 구조 생성 (재귀 깊이 문제 없음)

            Returns:
                dict: {
                  "root": goal_full_name,
                  "nodes": {
                    full_name: {
                      "full_name": str,
                      "type": "or" | "and",
                      "children": [child_full_name, ...],  # 이 노드를 활성화하는 선행 노드들
                      "is_entry_point": bool,
                      "is_goal": bool,
                    },
                    ...
                  },
                  "total_nodes": int,
                  "entry_points": [str, ...],
                  "goal": str,
                }
            """
            import json as _json

            try:
                with open(attack_graph_file, 'r', encoding='utf-8') as _f:
                    _ag = _json.load(_f)
            except Exception as e:
                logger.warning(f"공격 그래프 파일 로드 실패 (attack tree): {e}")
                return {}

            steps = _ag.get('attack_steps', {})
            if not steps:
                return {}

            entry_points_set = set(entry_points)

            # children/parents 관계 구성
            children_map = {name: list(node.get('children', {}).values()) for name, node in steps.items()}
            parents_map  = {name: list(node.get('parents',  {}).values()) for name, node in steps.items()}

            # --- 1. Forward reachable: entry_points에서 BFS ---
            forward_reachable = set()
            fwd_queue = [ep for ep in entry_points if ep in steps]
            forward_reachable.update(fwd_queue)
            fwd_visited = set(forward_reachable)
            while fwd_queue:
                cur = fwd_queue.pop(0)
                for child in children_map.get(cur, []):
                    if child not in fwd_visited and child in steps:
                        fwd_visited.add(child)
                        forward_reachable.add(child)
                        fwd_queue.append(child)

            # --- 2. Backward reachable: goal에서 역방향 BFS ---
            if target_full_name not in steps:
                logger.warning(f"목표 '{target_full_name}'가 공격 그래프에 없습니다.")
                return {}

            backward_reachable = {target_full_name}
            bwd_queue = [target_full_name]
            bwd_visited = {target_full_name}
            while bwd_queue:
                cur = bwd_queue.pop(0)
                for parent in parents_map.get(cur, []):
                    if parent not in bwd_visited and parent in steps:
                        bwd_visited.add(parent)
                        backward_reachable.add(parent)
                        bwd_queue.append(parent)

            # --- 3. 교집합: 실제 공격 경로에 포함되는 노드 ---
            relevant_nodes = forward_reachable & backward_reachable
            logger.info(f"Attack Tree 관련 노드 수: {len(relevant_nodes)} / 전체 {len(steps)}")

            # --- 4. Iterative BFS로 flat DAG 구조 생성 ---
            # goal을 루트로, entry_point를 리프로 하는 역방향 트리
            # "children" = 이 노드를 활성화하는 선행 조건 노드들 (역방향)
            tree_nodes = {}
            bfs_queue = [target_full_name]
            bfs_visited = {target_full_name}

            while bfs_queue:
                cur = bfs_queue.pop(0)
                node_data = steps.get(cur, {})

                # 역방향: 이 노드를 활성화하는 선행 노드들 (relevant_nodes 중에서만)
                prereqs = [
                    p for p in parents_map.get(cur, [])
                    if p in relevant_nodes and p not in bfs_visited
                ]

                tree_nodes[cur] = {
                    "full_name": cur,
                    "type": node_data.get('type', 'or'),
                    "children": prereqs,
                    "is_entry_point": cur in entry_points_set,
                    "is_goal": cur == target_full_name,
                }

                for p in prereqs:
                    if p not in bfs_visited:
                        bfs_visited.add(p)
                        bfs_queue.append(p)

            return {
                "root": target_full_name,
                "nodes": tree_nodes,
                "total_nodes": len(tree_nodes),
                "entry_points": list(entry_points),
                "goal": target_full_name,
            }

        def build_attack_tree_from_simulation(target_full_name, entry_points, attack_graph_file, compromised_node_names_set):
            """
            시뮬레이션에서 실제로 공격자가 탐색(compromised)한 노드들만 사용하여
            Attack Tree를 구성합니다. BreadthFirstAttacker 등 일반 공격자에 사용.

            공격 그래프의 구조(children/parents)는 유지하되,
            노드 집합은 실제 시뮬레이션에서 침해된 노드들로 제한합니다.

            Returns:
                dict: build_attack_tree와 동일한 구조
            """
            import json as _json

            try:
                with open(attack_graph_file, 'r', encoding='utf-8') as _f:
                    _ag = _json.load(_f)
            except Exception as e:
                logger.warning(f"공격 그래프 파일 로드 실패 (sim attack tree): {e}")
                return {}

            steps = _ag.get('attack_steps', {})
            if not steps:
                return {}

            if target_full_name not in steps:
                logger.warning(f"목표 '{target_full_name}'가 공격 그래프에 없습니다.")
                return {}

            entry_points_set = set(entry_points)

            # 실제 시뮬레이션에서 침해된 노드만 사용 (entry_points 포함)
            allowed_nodes = compromised_node_names_set | entry_points_set

            # children/parents 관계 구성 (allowed_nodes 내에서만)
            parents_map = {
                name: [p for p in node.get('parents', {}).values() if p in allowed_nodes]
                for name, node in steps.items()
                if name in allowed_nodes
            }

            # goal에서 역방향 BFS로 트리 구성 (allowed_nodes 내에서만)
            tree_nodes = {}
            bfs_queue = [target_full_name]
            bfs_visited = {target_full_name}

            while bfs_queue:
                cur = bfs_queue.pop(0)
                if cur not in allowed_nodes and cur != target_full_name:
                    continue
                node_data = steps.get(cur, {})

                prereqs = [
                    p for p in parents_map.get(cur, [])
                    if p not in bfs_visited
                ]

                tree_nodes[cur] = {
                    "full_name": cur,
                    "type": node_data.get('type', 'or'),
                    "children": prereqs,
                    "is_entry_point": cur in entry_points_set,
                    "is_goal": cur == target_full_name,
                }

                for p in prereqs:
                    if p not in bfs_visited:
                        bfs_visited.add(p)
                        bfs_queue.append(p)

            logger.info(f"[Sim-based Attack Tree] 관련 노드 수: {len(tree_nodes)} / 침해된 노드 {len(compromised_node_names_set)}")

            return {
                "root": target_full_name,
                "nodes": tree_nodes,
                "total_nodes": len(tree_nodes),
                "entry_points": list(entry_points),
                "goal": target_full_name,
            }


        for agent_name, agent_settings in sim.agent_settings.items():
            # 공격자만 확인 (방어자는 goals가 없음)
            if hasattr(agent_settings, 'goals') and agent_settings.goals:
                agent_goals = list(agent_settings.goals)
                goals_achieved = []
                goals_not_achieved = []
                agent_attack_paths = {}
                agent_attack_trees = {}

                # Entry points 추출
                entry_points = []
                if hasattr(agent_settings, 'entry_points') and agent_settings.entry_points:
                    entry_points = [node.full_name for node in agent_settings.entry_points]

                # AllPathsAttacker 여부 확인
                try:
                    from malsim.policies.attackers.all_paths_attacker import AllPathsAttacker as _AllPathsAttacker
                    is_all_paths = (
                        agent_settings.policy is not None
                        and issubclass(agent_settings.policy, _AllPathsAttacker)
                    )
                except ModuleNotFoundError:
                    is_all_paths = False
                logger.info(f"[{agent_name}] policy={getattr(agent_settings.policy, '__name__', None)}, is_all_paths={is_all_paths}")

                for goal_node in agent_goals:
                    goal = goal_node.full_name
                    if goal in compromised_node_names: # 목표 자산을 compromise 했는지 확인
                        goals_achieved.append(goal)
                        logger.info(f"✅ [{agent_name}] 목표 달성: {goal}")

                        # 공격 경로 추적 (그래프 기반 DFS - 모든 경로)
                        all_paths_for_goal = trace_all_attack_paths_from_graph(
                            goal,
                            entry_points,
                            attack_graph_file,
                            max_paths=200,
                            max_depth=50,
                        )
                        agent_attack_paths[goal] = all_paths_for_goal

                        # Attack Tree 생성
                        # - AllPathsAttacker: 공격 그래프 전체 기반 (모든 가능한 경로)
                        # - 그 외 (BreadthFirst 등): 실제 시뮬레이션에서 탐색된 노드만
                        if is_all_paths:
                            tree = build_attack_tree(goal, entry_points, attack_graph_file)
                            logger.info(f"🌳 [{agent_name}] AllPaths 트리: '{goal}' 관련 노드 수: {tree.get('total_nodes', 'N/A')}")
                        else:
                            tree = build_attack_tree_from_simulation(
                                goal, entry_points, attack_graph_file, compromised_node_names
                            )
                            logger.info(f"🌳 [{agent_name}] Sim 기반 트리: '{goal}' 관련 노드 수: {tree.get('total_nodes', 'N/A')} (침해 노드 {len(compromised_node_names)}개 기반)")
                        agent_attack_trees[goal] = tree

                        # 경로 로그 출력
                        logger.info(f"📍 [{agent_name}] '{goal}'까지 발견된 경로 수: {len(all_paths_for_goal)}")

                    else:
                        goals_not_achieved.append(goal)
                        logger.warning(f"❌ [{agent_name}] 목표 미달성: {goal}")
                        attack_path_found = False
                
                goals_status[agent_name] = {
                    "total_goals": len(agent_goals),
                    "achieved": goals_achieved,
                    "not_achieved": goals_not_achieved,
                    "success_rate": len(goals_achieved) / len(agent_goals) if agent_goals else 0.0,
                }
                
                if agent_attack_paths:
                    attack_paths[agent_name] = agent_attack_paths
                if agent_attack_trees:
                    attack_trees[agent_name] = agent_attack_trees

        
        # 공격 경로 발견 여부 로그
        if attack_path_found:
            logger.info("✅ 모든 공격 목표가 달성되었습니다. 공격 경로가 존재합니다.")
        else:
            logger.warning("❌ 일부 공격 목표가 달성되지 않았습니다. 공격 경로가 차단되었거나 존재하지 않습니다.")
        
        # 경로 수 요약 생성
        attack_paths_count = {
            agent: {
                goal: len(paths)
                for goal, paths in goals_paths.items()
            }
            for agent, goals_paths in attack_paths.items()
        }

        result = {
            # "iterations": iterations_serialized,
            # "agent_states": {
            #     name: {
            #         "type": type(state).__name__,
            #         "iteration": state.iteration,
            #         "performed_nodes_count": len(state.performed_nodes),
            #     }
            #     for name, state in sim.agent_states.items()
            # },
            # "agent_rewards": {
            #     name: sim.agent_reward(name)
            #     for name in sim.agent_states.keys()
            # },
            # "compromised_nodes": [
            #     {
            #         "id": node.id,
            #         "name": node.name,
            #         "full_name": node.full_name,
            #         "type": node.type,
            #     }
            #     for node in sim.compromised_nodes
            # ],
            # "total_compromised": len(sim.compromised_nodes),
            # "goals_status": goals_status,
            "attack_path_found": attack_path_found, # true / false
            "attack_paths": attack_paths,           # {agent: {goal: [[step, ...], ...]}}
            "attack_paths_count": attack_paths_count, # {agent: {goal: N}}
            "attack_trees": attack_trees,           # {agent: {goal: tree_dict}}
            "shortest_paths": shortest_path_result, # {available, agents: {agent: {goals: {goal: path_info}}}}
        }
        
        logger.info(f"침해된 노드 수: {len(sim.compromised_nodes)}")
        # logger.info(f"에이전트 보상: {result['agent_rewards']}")
        
        # Attack Graph 정보 추가
        # with open(attack_graph_file, 'r', encoding='utf-8') as f:
        #     attack_graph_data = json.load(f)
        
        simulation_results[session_id].update({
            "status": SimulationStatus.COMPLETED,
            "completed_at": datetime.now().isoformat(),
            "result": result,
            # "attack_graph": attack_graph_data,
            "log_file": str(log_file),
        })
        
        logger.info(f"시뮬레이션 완료: {session_id}")
        
    except Exception as e:
        logger.error(f"시뮬레이션 실패: {session_id} - {str(e)}", exc_info=True)
        simulation_results[session_id].update({
            "status": SimulationStatus.FAILED,
            "completed_at": datetime.now().isoformat(),
            "error": str(e),
            "log_file": str(log_file),
        })
    finally:
        # 파일 핸들러 제거 (메모리 누수 방지)
        root_logger.removeHandler(file_handler)
        file_handler.close()

# === API 엔드포인트 ===

@app.get("/")
async def root():
    """API 루트"""
    return {
        "name": "MAL Simulator API",
        "version": "1.0.0",
        "status": "running",
        "endpoints": {
            # "POST /simulation/run": "시뮬레이션 실행",
            "POST /simulation/shortest_path": "최단 공격 경로 계산",
            "GET /simulation/{session_id}": "시뮬레이션 결과 조회",
            "GET /simulation/{session_id}/status": "시뮬레이션 상태 확인",
            "GET /simulations": "모든 시뮬레이션 목록",
        }
    }


@app.get("/health")
async def health_check():
    """헬스 체크"""
    return {"status": "healthy", "timestamp": datetime.now().isoformat()}


@app.post("/simulation/run", response_model=SimulationResponse)
async def run_simulation_endpoint(
    request: SimulationRequest,
    background_tasks: BackgroundTasks
):
    """
    시뮬레이션 실행
    
    시나리오 YAML을 받아서 비동기로 시뮬레이션을 실행하고 session_id를 반환합니다.
    """
    try:
        # 세션 ID 생성
        session_id = str(uuid.uuid4())
        created_at = datetime.now().isoformat()
        
        # 시나리오 파일 저장
        scenario_file = save_scenario_file(session_id, request.scenario_yaml)
        
        # 결과 저장소에 초기 상태 등록
        simulation_results[session_id] = {
            "session_id": session_id,
            "status": SimulationStatus.PENDING,
            "created_at": created_at,
            "scenario_file": str(scenario_file),
        }
        
        # 백그라운드 작업으로 시뮬레이션 실행
        background_tasks.add_task(
            run_simulation_task,
            session_id,
            scenario_file,
            request.seed,
            request.ttc_mode
        )
        
        return SimulationResponse(
            session_id=session_id,
            status=SimulationStatus.PENDING,
            message="시뮬레이션이 큐에 추가되었습니다.",
            created_at=created_at
        )
        
    except Exception as e:
        logger.error(f"시뮬레이션 요청 처리 실패: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/simulation/shortest_path")
async def shortest_path_endpoint(request: Request):
    """
    최단 공격 경로 계산

    시나리오 YAML을 받아 시뮬레이션 전체를 실행하지 않고, entry point에서 goal까지의
    TTC 기준 shortest path만 계산해서 즉시 반환합니다.
    """
    session_id = str(uuid.uuid4())

    try:
        scenario_file, seed, ttc_mode = await prepare_shortest_path_request(session_id, request)
        shortest_path_result = calculate_shortest_path_from_file(scenario_file, seed, ttc_mode)

        return {
            "success": True,
            "session_id": session_id,
            "sessionId": session_id,
            "created_at": datetime.now().isoformat(),
            "data": shortest_path_result
        }

    except ValueError as e:
        logger.error(f"Shortest path 요청 값 오류: {str(e)}", exc_info=True)
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Shortest path 계산 실패: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/simulation/run-file")
async def run_simulation_from_file(
    scenario_file: UploadFile = File(..., description="시나리오 YAML 파일"),
    lang_file: Optional[UploadFile] = File(None, description="MAL 언어 파일 (.mar)"),
    model_file: Optional[UploadFile] = File(None, description="모델 파일 (.yml)"),
    seed: Optional[int] = None,
    ttc_mode: int = 3,
    background_tasks: BackgroundTasks = None
):
    """
    시뮬레이션 실행 (파일 업로드)
    
    시나리오 YAML 파일과 함께 MAL 언어 파일(.mar), 모델 파일(.yml)을 업로드하여 시뮬레이션을 실행합니다.
    
    - scenario_file: 시나리오 YAML 파일 (필수)
    - lang_file: MAL 언어 파일 (.mar) (선택)
    - model_file: 모델 파일 (.yml) (선택)
    - seed: 시뮬레이션 시드값 (선택)
    - ttc_mode: TTC 모드 (0=EFFORT_BASED_PER_STEP_SAMPLE, 1=PER_STEP_SAMPLE, 2=PRE_SAMPLE, 3=EXPECTED_VALUE, 4=DISABLED)
    """
    try:
        # 세션 ID 생성
        session_id = str(uuid.uuid4())
        created_at = datetime.now().isoformat()
        session_dir = WORK_DIR / session_id
        session_dir.mkdir(exist_ok=True)
        
        # 시나리오 파일 읽기 및 저장
        scenario_content = await scenario_file.read()
        scenario_yaml = scenario_content.decode('utf-8')
        scenario_dict = yaml.safe_load(scenario_yaml)
        
        # MAL 언어 파일(.mar) 업로드 처리
        if lang_file:
            lang_filename = lang_file.filename or "language.mar"
            lang_path = session_dir / lang_filename
            
            lang_content = await lang_file.read()
            with open(lang_path, 'wb') as f:
                f.write(lang_content)
            
            # 시나리오 YAML의 lang_file 경로 업데이트 (상대 경로 사용)
            scenario_dict['lang_file'] = lang_filename
            logger.info(f"MAL 언어 파일 저장: {lang_path}")
        
        # 모델 파일(.yml) 업로드 처리
        if model_file:
            model_filename = model_file.filename or "model.yml"
            model_path = session_dir / model_filename
            
            model_content = await model_file.read()
            model_yaml = model_content.decode('utf-8')
            with open(model_path, 'w', encoding='utf-8') as f:
                f.write(model_yaml)
            
            # 시나리오 YAML의 model_file 경로 업데이트 (상대 경로 사용)
            scenario_dict['model_file'] = model_filename
            logger.info(f"모델 파일 저장: {model_path}")
        
        # 업데이트된 시나리오 YAML 저장
        scenario_path = session_dir / "scenario.yml"
        with open(scenario_path, 'w', encoding='utf-8') as f:
            yaml.safe_dump(scenario_dict, f, allow_unicode=True, sort_keys=False)
        
        # 결과 저장소에 초기 상태 등록
        simulation_results[session_id] = {
            "session_id": session_id,
            "status": SimulationStatus.PENDING,
            "created_at": created_at,
            "scenario_file": str(scenario_path),
            "uploaded_files": {
                "scenario": scenario_file.filename,
                "lang": lang_file.filename if lang_file else None,
                "model": model_file.filename if model_file else None,
            }
        }
        
        # 백그라운드 작업으로 시뮬레이션 실행
        background_tasks.add_task(
            run_simulation_task,
            session_id,
            scenario_path,
            seed,
            ttc_mode
        )
        
        return SimulationResponse(
            session_id=session_id,
            status=SimulationStatus.PENDING,
            message="시뮬레이션이 큐에 추가되었습니다.",
            created_at=created_at
        )
        
    except Exception as e:
        logger.error(f"파일 업로드 실패: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/simulation/{session_id}", response_model=SimulationResult)
async def get_simulation_result(session_id: str):
    """
    시뮬레이션 결과 조회
    
    session_id로 시뮬레이션 결과를 조회합니다.
    """
    try:
        if session_id not in simulation_results:
            raise HTTPException(status_code=404, detail="시뮬레이션을 찾을 수 없습니다.")
        
        result = simulation_results[session_id]
        logger.info(f"결과 조회: {session_id}, 상태: {result.get('status')}")
        
        return SimulationResult(**result)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"결과 조회 실패: {session_id} - {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"결과 조회 중 오류 발생: {str(e)}")


@app.get("/simulation/{session_id}/status")
async def get_simulation_status(session_id: str):
    """
    시뮬레이션 상태 확인
    
    session_id로 시뮬레이션의 현재 상태를 확인합니다.
    """
    if session_id not in simulation_results:
        raise HTTPException(status_code=404, detail="시뮬레이션을 찾을 수 없습니다.")
    
    result = simulation_results[session_id]
    
    return {
        "session_id": session_id,
        "status": result["status"],
        "created_at": result.get("created_at"),
        "completed_at": result.get("completed_at"),
    }


@app.get("/simulations")
async def list_simulations():
    """
    모든 시뮬레이션 목록 조회
    
    현재 실행된 모든 시뮬레이션의 목록을 반환합니다.
    """
    return {
        "total": len(simulation_results),
        "simulations": [
            {
                "session_id": sid,
                "status": data["status"],
                "created_at": data.get("created_at"),
                "completed_at": data.get("completed_at"),
            }
            for sid, data in simulation_results.items()
        ]
    }


@app.delete("/simulation/{session_id}")
async def delete_simulation(session_id: str):
    """
    시뮬레이션 결과 삭제
    
    session_id로 시뮬레이션 결과를 삭제합니다.
    """
    if session_id not in simulation_results:
        raise HTTPException(status_code=404, detail="시뮬레이션을 찾을 수 없습니다.")
    
    # 파일 삭제
    session_dir = WORK_DIR / session_id
    if session_dir.exists():
        import shutil
        shutil.rmtree(session_dir)
    
    # 메모리에서 삭제
    del simulation_results[session_id]
    
    return {"message": f"시뮬레이션 {session_id}가 삭제되었습니다."}


if __name__ == "__main__":
    # 서버 실행
    uvicorn.run(
        "api_server:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info"
    )

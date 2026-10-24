import asyncio
from copy import deepcopy
import json
from pathlib import Path
from types import SimpleNamespace

from fastapi import HTTPException
import httpx
import pytest
import yaml

import main
from attack_tree import extract_attack_tree

FIXTURES = Path(__file__).parent / "fixtures"


def payload(attacker="BreadthFirstAttacker", goals=None):
    return {
        "language_graph": json.loads((FIXTURES / "simulation.json").read_text()),
        "model": {
            "metadata": {"name": "Simulation test", "langID": "autotara-test", "langVersion": "1.0.0"},
            "assets": {"1": {"name": "Unit:1", "type": "Device", "associated_assets": {}}},
        },
        "entry_points": ["Unit:1:entry"],
        "goals": goals or ["Unit:1:target"],
        "attacker_type": attacker,
    }


async def send(app, body):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        return await client.post("/api/simulations", json=body)


@pytest.mark.parametrize("attacker", ["BreadthFirstAttacker", "DepthFirstAttacker"])
def test_real_malsim_scenario_and_compromised_tree(tmp_path, attacker):
    app = main.create_app(tmp_path)
    response = asyncio.run(send(app, payload(attacker)))
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["attackerType"] == attacker
    assert result["stopReason"] == "goals_reached"
    tree = result["tree"]
    assert {node["name"] for node in tree["nodes"]} == {"entry", "left", "right", "gate", "target"}
    assert tree["compromisedAssets"] == ["Unit:1"]
    gate = next(node for node in tree["nodes"] if node["name"] == "gate")
    assert gate["type"] == "and"
    assert len([edge for edge in tree["edges"] if edge["target"] == gate["id"]]) == 2
    assert "blocked" not in {node["name"] for node in tree["performedNodes"]}
    assert {node["id"] for node in tree["nodes"]} <= {node["id"] for node in tree["performedNodes"]}
    performed_ids = {node["id"] for node in tree["performedNodes"]}
    assert all(edge["source"] in performed_ids and edge["target"] in performed_ids for edge in tree["performedEdges"])
    assert all(edge in tree["performedEdges"] for edge in tree["edges"])
    directory = tmp_path / result["runId"]
    scenario = yaml.safe_load((directory / "scenario.yml").read_text())
    assert scenario["agents"]["Attacker"]["agent_class"] == attacker
    assert scenario["agents"]["Attacker"]["entry_points"] == ["Unit:1:entry"]
    assert scenario["agents"]["Attacker"]["goals"] == ["Unit:1:target"]
    assert (directory / scenario["lang_file"]).exists()
    assert (directory / scenario["model_file"]).exists()
    raw_graph = json.loads((directory / "attackgraph.json").read_text())
    assert raw_graph  # persisted real graph, not the filtered display tree

    async def downloads():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            for url in result["artifacts"].values():
                file = await client.get(url)
                assert file.status_code == 200
                assert file.content
            assert (await client.get(f'/api/simulations/{result["runId"]}/files/request.json')).status_code == 404
            assert (await client.get('/api/simulations/not-a-uuid/files/result.json')).status_code == 422
    asyncio.run(downloads())


def test_real_policies_produce_different_orders_and_runs_do_not_share_files(tmp_path):
    app = main.create_app(tmp_path)

    async def both():
        return await asyncio.gather(*(send(app, payload(attacker)) for attacker in ["BreadthFirstAttacker", "DepthFirstAttacker"]))
    responses = asyncio.run(both())
    assert all(response.status_code == 200 for response in responses)
    bfs, dfs = [response.json() for response in responses]
    assert bfs["runId"] != dfs["runId"]
    order = lambda result: {node["name"]: node["performedAt"] for node in result["tree"]["performedNodes"]}
    assert order(bfs) != order(dfs)


def test_unreached_and_partial_targets_do_not_get_fabricated_trees(tmp_path):
    app = main.create_app(tmp_path)
    response = asyncio.run(send(app, payload(goals=["Unit:1:target", "Unit:1:unreachable"])))
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["stopReason"] == "exhausted"
    assert {node["name"]: node["reached"] for node in result["tree"]["targets"]} == {"target": True, "unreachable": False}
    assert "unreachable" not in {node["name"] for node in result["tree"]["nodes"]}
    response = asyncio.run(send(app, {**payload(), "max_steps": 1}))
    result = response.json()
    assert result["stopReason"] == "max_steps"
    assert result["partial"] is True
    assert result["tree"]["nodes"] == []
    assert result["performedCount"] > 0
    assert result["tree"]["performedNodes"]
    performed_ids = {node["id"] for node in result["tree"]["performedNodes"]}
    assert all(edge["source"] in performed_ids and edge["target"] in performed_ids for edge in result["tree"]["performedEdges"])


def test_entry_equal_to_target_is_reached_without_actions(tmp_path):
    response = asyncio.run(send(main.create_app(tmp_path), payload(goals=["Unit:1:entry"])))
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["steps"] == 0
    assert [node["name"] for node in result["tree"]["nodes"]] == ["entry"]
    assert result["tree"]["edges"] == []


@pytest.mark.parametrize("changes", [
    {"attacker_type": "KeyboardAgent"}, {"entry_points": []}, {"goals": ["Missing:target"]},
    {"goals": ["invalid"]}, {"max_steps": 0}, {"lang_file": "/etc/passwd"},
    {"language_graph": {"metadata": []}},
])
def test_invalid_requests_are_rejected_without_launching_workers(tmp_path, changes):
    response = asyncio.run(send(main.create_app(tmp_path), {**payload(), **changes}))
    assert response.status_code == 422
    assert not list(tmp_path.iterdir())


@pytest.mark.parametrize("goal", ["Unit:1:missingStep", "Unit:1:protected"])
def test_unknown_or_condition_endpoints_return_errors(tmp_path, goal):
    response = asyncio.run(send(main.create_app(tmp_path), payload(goals=[goal])))
    assert response.status_code == 422
    assert "Simulation failed" in response.json()["detail"]


class Node:
    def __init__(self, name, type="or"):
        self.id = name
        self.name = name
        self.full_name = f"Unit:{name}"
        self.type = type
        self.parents = set()
        self.model_asset = SimpleNamespace(name="Unit", id=1, type="Device")


def test_filter_keeps_and_support_cycles_multiple_entries_and_excludes_unperformed_branches():
    nodes = {name: Node(name) for name in ["entry", "second", "and", "cycle", "target", "offPath", "notPerformed", "beforeEntry"]}
    nodes["and"].type = "and"
    for source, target in [("beforeEntry", "entry"), ("entry", "and"), ("second", "and"), ("and", "cycle"), ("cycle", "and"), ("and", "target"), ("notPerformed", "target"), ("entry", "offPath")]:
        nodes[target].parents.add(nodes[source])
    performed = set(nodes.values()) - {nodes["notPerformed"]}
    state = SimpleNamespace(performed_nodes=performed, entry_points={nodes["entry"], nodes["second"]}, goals={nodes["target"]}, performed_nodes_order={0: performed})
    tree = extract_attack_tree(SimpleNamespace(nodes=nodes), state)
    assert {node["id"] for node in tree["nodes"]} == {"entry", "second", "and", "cycle", "target"}
    assert {tuple(edge.values()) for edge in tree["edges"]} == {("entry", "and"), ("second", "and"), ("and", "cycle"), ("cycle", "and"), ("and", "target")}
    assert {tuple(edge.values()) for edge in tree["performedEdges"]} == {
        ("entry", "and"), ("second", "and"), ("and", "cycle"),
        ("cycle", "and"), ("and", "target"), ("entry", "offPath"),
    }
    # No reached Target must not erase the compromised subgraph. Entry nodes
    # remain granted initially; their incoming prerequisites are not added.
    state.goals = {nodes["notPerformed"]}
    unreached = extract_attack_tree(SimpleNamespace(nodes=nodes), state)
    assert unreached["nodes"] == []
    assert unreached["edges"] == []
    assert unreached["performedNodes"] == tree["performedNodes"]
    assert unreached["performedEdges"] == tree["performedEdges"]


@pytest.mark.parametrize("disconnected,expected_status", [(False, 504), (True, 499)])
def test_timeout_and_disconnect_terminate_worker(tmp_path, monkeypatch, disconnected, expected_status):
    async def check():
        done = asyncio.Event()
        class Process:
            returncode = None
            async def wait(self):
                await done.wait()
            def kill(self):
                self.returncode = -9
                done.set()
        process = Process()
        async def spawn(*args, **kwargs):
            return process
        async def is_disconnected():
            return disconnected
        monkeypatch.setattr(main.asyncio, "create_subprocess_exec", spawn)
        with pytest.raises(HTTPException) as error:
            await main.run_worker(tmp_path, SimpleNamespace(is_disconnected=is_disconnected), timeout=0)
        assert error.value.status_code == expected_status
        assert process.returncode == -9
    asyncio.run(check())


def test_tesla_sample_bfs_and_dfs_reach_requested_target(tmp_path):
    sample = Path(__file__).resolve().parents[2] / "sample"
    body = {
        "language_graph": json.loads((sample / "vehicleLang_v2-langgraph.json").read_text()),
        "model": yaml.safe_load((sample / "Tesla_Model_S_Model.yaml").read_text()),
        "entry_points": ["QtCarBrowser:localConnect"],
        "goals": ["PT-CAN:messageInjection"],
        "attacker_type": "BreadthFirstAttacker",
    }
    original = deepcopy(body)
    app = main.create_app(tmp_path)
    for attacker in ["BreadthFirstAttacker", "DepthFirstAttacker"]:
        response = asyncio.run(send(app, {**body, "attacker_type": attacker}))
        assert response.status_code == 200, response.text
        result = response.json()
        assert result["tree"]["targets"][0]["reached"] is True
        assert result["stopReason"] == "goals_reached"
        assert result["performedCount"] > len(result["tree"]["nodes"]) > 1
        names = {node["fullName"] for node in result["tree"]["nodes"]}
        assert {"QtCarBrowser:localConnect", "PT-CAN:messageInjection"} <= names
    assert body == original

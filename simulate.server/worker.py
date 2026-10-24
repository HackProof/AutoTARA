"""One isolated malsim process per request, with its own working directory/logs."""

import json
from pathlib import Path
import sys
import traceback

from attack_tree import extract_attack_tree


def run(directory: Path):
    # malsim/maltoolbox initialize log files when imported.
    (directory / "logs").mkdir(exist_ok=True)
    from malsim import MalSimulator, run_simulation
    from malsim.scenario import Scenario

    request = json.loads((directory / "request.json").read_text(encoding="utf-8"))
    scenario = Scenario.load_from_file(str(directory / "scenario.yml"))
    # Reject Defense/Existence endpoints instead of treating conditions as attacks.
    for settings in scenario.attacker_settings.values():
        for node in settings.entry_points | settings.goals:
            if node.type not in ("and", "or"):
                raise ValueError(f"Choose an attack step, not a condition: {node.full_name}")
    simulator = MalSimulator.from_scenario(scenario)
    actions = run_simulation(simulator, max_steps=request["max_steps"])
    state = simulator.agent_states["Attacker"]
    graph = simulator.sim_state.attack_graph
    graph.save_to_file(str(directory / "attackgraph.json"))
    tree = extract_attack_tree(graph, state)
    reached_all = all(target["reached"] for target in tree["targets"])
    stop_reason = "goals_reached" if reached_all else "exhausted" if simulator.done() else "max_steps"
    result = {
        "attackerType": request["attacker_type"],
        "seed": request["seed"],
        "ttcMode": "DISABLED",
        "stopReason": stop_reason,
        "partial": stop_reason == "max_steps",
        "steps": len(actions.get("Attacker", [])),
        "attackGraphNodeCount": len(graph.nodes),
        "performedCount": len(state.performed_nodes),
        "tree": tree,
    }
    (directory / "result.json").write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    run_directory = Path(sys.argv[1]).resolve()
    try:
        run(run_directory)
    except Exception as error:
        traceback.print_exc()
        (run_directory / "error.json").write_text(
            json.dumps({"detail": f"Simulation failed: {error}"}), encoding="utf-8"
        )
        sys.exit(1)

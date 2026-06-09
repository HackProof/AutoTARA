#!/usr/bin/env python3
"""
Command Line Interface for Meta Attack Language Attack Graph Simulator
"""

import sys
import os
from typing import List, Tuple

from utils import (
    validate_file_path, validate_entry_points, validate_iterations,
    print_statistics, print_version, print_help, handle_error, handle_keyboard_interrupt
)


def main():
    """Main function using original parsing logic with added flags"""
    # Handle special flags first
    if '--help' in sys.argv:
        print_help()
        sys.exit(0)
    
    if '--version' in sys.argv:
        print_version()
        sys.exit(0)
    
    # Original argument validation (exact copy)
    if len(sys.argv) < 5:
        print("Usage: sim <yaml_file> <entry_point_count> <entry_points...> <target> <iterations> [options]")
        print("Options: -h (hide hidden), -a (generate allpaths)")
        sys.exit(1)
    
    try:
        # Original parsing logic (exact copy)
        yaml_file = sys.argv[1]
        entry_point_count = int(sys.argv[2])
        
        # Validate argument count (original logic)
        expected_args_min = 3 + entry_point_count + 2  # base + entry_points + target + iterations
        
        if len(sys.argv) < expected_args_min:
            print(f"Error: Expected {expected_args_min} arguments minimum, got {len(sys.argv)}")
            sys.exit(1)
        
        # Original indexing (exact copy)
        entry_points = sys.argv[3:3+entry_point_count]
        target = sys.argv[3 + entry_point_count]
        iterations = int(sys.argv[4 + entry_point_count])
        
        # Check optional flags
        hide_hidden = '-h' in sys.argv or '--hide-hidden' in sys.argv
        generate_allpaths = '-a' in sys.argv or '--allpaths' in sys.argv
        
        if iterations <= 0:
            print("Error: iterations must be positive")
            sys.exit(1)
        
        # Import and run (same as original but with flags)
        from simulator_core import AttackGraphSimulator
        from visualizer import AttackGraphVisualizer
        
        print("Starting simulator")
        print(f"  YAML file: {yaml_file}")
        print(f"  Entry points: {entry_points}")
        print(f"  Target: {target}")
        print(f"  Iterations: {iterations}")
        print(f"  Hide hidden nodes: {hide_hidden}")
        print(f"  Generate allpaths: {generate_allpaths}")
        print()
        
        simulator = AttackGraphSimulator(random_tie_breaking=True)
        simulator.load_yaml(yaml_file)
        simulator.set_entry_points(entry_points)
        simulator.set_target(target)
        
        # Find paths
        if not simulator.find_entry_to_target_paths():
            print("  No valid paths found")
            return
        
        visualizer = AttackGraphVisualizer(simulator)
        
        # Generate allpaths if requested
        if generate_allpaths:
            visualizer.generate_allpaths(hide_hidden)
            print()
        
        # Run simulation
        results = simulator.run_simulation_only(iterations)
        
        if results['shortest_paths']:
            visualizer.generate_critical_paths(results['edge_counts'], hide_hidden)
            print()
            print_statistics(results)
            visualizer.generate_ttc_distribution(results['global_ttcs'])
        
        print()
        print("Ending simulator")
        
    except FileNotFoundError:
        print(f"Error: Could not find file {yaml_file}")
        sys.exit(1)
    except ValueError as e:
        print(f"Error: {e}")
        sys.exit(1)
    except KeyboardInterrupt:
        print()
        print("Simulation interrupted by user")
        sys.exit(1)
    except Exception as e:
        print(f"Unexpected error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
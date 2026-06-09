#!/usr/bin/env python3
"""
Utility functions for Meta Attack Language Attack Graph Simulator
"""

import sys
import os
from typing import List


def print_progress_bar(iteration, total, prefix='', suffix='', length=50, fill='█'):
    """Print a progress bar"""
    percent = (iteration / total) * 100
    filled_length = int(length * iteration // total)
    bar = fill * filled_length + '-' * (length - filled_length)
    print(f'\r{prefix} |{bar}| {percent:.1f}% {suffix}', end='', flush=True)


def validate_file_path(file_path: str) -> str:
    """Validate that the file exists and return absolute path"""
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"File not found: {file_path}")
    
    if not os.path.isfile(file_path):
        raise ValueError(f"Path is not a file: {file_path}")
    
    return os.path.abspath(file_path)


def validate_entry_points(entry_points: List[str], max_count: int = 5) -> List[str]:
    """Validate entry points list"""
    if not entry_points:
        raise ValueError("At least one entry point is required")
    
    if len(entry_points) > max_count:
        raise ValueError(f"Maximum {max_count} entry points allowed, got {len(entry_points)}")
    
    # Remove duplicates while preserving order
    seen = set()
    unique_entry_points = []
    for ep in entry_points:
        if ep not in seen:
            seen.add(ep)
            unique_entry_points.append(ep)
    
    return unique_entry_points


def validate_iterations(iterations: int) -> int:
    """Validate iterations parameter"""
    if iterations <= 0:
        raise ValueError("Iterations must be a positive integer")
    
    if iterations > 1000000:
        print(f"Warning: {iterations} iterations may take a long time to complete")
    
    return iterations


def print_statistics(results: dict):
    """Print simulation statistics"""
    print()
    print("Global TTC statistics")
    if results['global_ttcs']:
        import numpy as np
        mean_ttc = np.mean(results['global_ttcs'])
        std_ttc = np.std(results['global_ttcs'])
        print(f"  Mean: {mean_ttc:.3f}")
        print(f"  Standard Deviation: {std_ttc:.3f}")
    else:
        print("  No successful simulations")


def print_version():
    """Print version information"""
    print("Meta Attack Language Attack Graph Simulator v2.0")
    print("Enhanced with Random Tie-Breaking and Fixed Hidden Node Processing")


def print_help():
    """Print help information"""
    print("Usage: sim [attackgraph.yml path] [entry point count] [entry points...] [target] [iterations] [options]")
    print()
    print("Arguments:")
    print("  attackgraph.yml     Path to the attack graph YAML file")
    print("  entry_point_count   Number of entry points (1-5)")
    print("  entry_points        Names of entry point nodes")
    print("  target              Name of target node")
    print("  iterations          Number of simulation iterations")
    print()
    print("Options:")
    print("  -h, --hide-hidden   Hide nodes with 'hidden' tag in visualization")
    print("  -a, --allpaths      Generate allpaths.png (default: only critical_paths.png)")
    print("  --help              Show this help message")
    print("  --version           Show version information")
    print()
    print("Examples:")
    print("  sim graph.yml 1 EntryPoint Target 1000")
    print("  sim graph.yml 2 EP1 EP2 Target 5000 -h")
    print("  sim graph.yml 1 Entry Target 1000 -a -h")
    print()
    print("Output files:")
    print("  critical_paths.png  Critical attack paths visualization (always generated)")
    print("  allpaths.png        All possible paths (with -a option)")
    print("  global_ttc.png      Time-to-compromise distribution (always generated)")


def handle_error(error: Exception, exit_code: int = 1):
    """Handle errors gracefully"""
    print(f"Error: {error}", file=sys.stderr)
    sys.exit(exit_code)


def handle_keyboard_interrupt():
    """Handle Ctrl+C gracefully"""
    print()
    print("Simulation interrupted by user")
    sys.exit(130)  # Standard exit code for SIGINT
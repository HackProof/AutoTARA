#!/usr/bin/env python3
"""
AttackStep class for Meta Attack Language Attack Graph Simulator
"""

import numpy as np
from typing import Dict, List


class AttackStep:
    """Attack step node in the attack graph"""
    
    __slots__ = ['id', 'name', 'asset', 'type', 'ttc_dist', 'parents', 'children', 'tags',
                 'defended_by', 'defend_success', 'local_ttc', 'completion_time', 'is_necessary']
    
    def __init__(self, node_id: int, name: str, asset: str, step_type: str,
                 ttc_dist: dict = None, parents: dict = None, children: dict = None,
                 tags: list = None, is_necessary: bool = True):
        self.id = node_id
        self.name = name
        self.asset = asset
        self.type = step_type
        self.ttc_dist = ttc_dist
        self.parents = parents or {}
        self.children = children or {}
        self.tags = tags or []
        self.is_necessary = is_necessary
        
        # Defense properties
        self.defended_by = None
        self.defend_success = None
        
        # Simulation properties
        self.local_ttc = 0.0
        self.completion_time = None

    def sample_ttc(self) -> float:
        """Sample TTC from distribution"""
        if not self.ttc_dist or not self.ttc_dist.get('name'):
            return 0.0
            
        dist_name = self.ttc_dist['name']
        args = self.ttc_dist.get('arguments', [])
        
        try:
            # Basic distributions
            if dist_name == 'Gamma' and len(args) >= 2:
                return np.random.gamma(args[0], args[1])
            elif dist_name == 'Exponential' and len(args) >= 1:
                return np.random.exponential(1/args[0])
            elif dist_name == 'Bernoulli' and len(args) >= 1:
                return 0.0 if np.random.random() < args[0] else np.inf
            elif dist_name == 'LogNormal' and len(args) >= 2:
                return np.random.lognormal(args[0], args[1])
            elif dist_name == 'Uniform' and len(args) >= 2:
                return np.random.uniform(args[0], args[1])
            elif dist_name == 'Pareto' and len(args) >= 2:
                return np.random.pareto(args[1]) * args[0]
            elif dist_name == 'TruncatedNormal' and len(args) >= 2:
                return max(0, np.random.normal(args[0], np.sqrt(args[1])))
            elif dist_name == 'Binomial' and len(args) >= 2:
                return float(np.random.binomial(int(args[0]), args[1]))
            
            # Predefined combination distributions
            elif dist_name == 'EasyAndCertain':
                return np.random.exponential(1.0)
            elif dist_name == 'EasyAndUncertain':
                return 0.0 if np.random.random() < 0.5 else np.inf
            elif dist_name == 'HardAndCertain':
                return np.random.exponential(10.0)
            elif dist_name == 'HardAndUncertain':
                return np.random.exponential(10.0) if np.random.random() < 0.5 else np.inf
            elif dist_name == 'VeryHardAndCertain':
                return np.random.exponential(100.0)
            elif dist_name == 'VeryHardAndUncertain':
                return np.random.exponential(100.0) if np.random.random() < 0.5 else np.inf
                
        except (ValueError, ZeroDivisionError):
            pass
        return 0.0
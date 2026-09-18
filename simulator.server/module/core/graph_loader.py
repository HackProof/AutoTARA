"""Normalize MAL YAML by node ID, retaining edges from either relationship map."""

import math

import yaml


def node_id(value):
    if isinstance(value, bool) or not isinstance(value, (int, str)) or value == '':
        raise ValueError(f'Invalid node ID: {value!r}')
    # Preserve the numeric IDs used by the API, while accepting string IDs.
    text = str(value)
    try:
        number = int(text)
        return number if str(number) == text else text
    except ValueError:
        return text


def boolean(value, field):
    if isinstance(value, bool):
        return value
    if isinstance(value, str) and value.lower() in {'true', 'false'}:
        return value.lower() == 'true'
    raise ValueError(f'{field} must be true or false')


def defense_probability(record):
    value = record.get('defense_status')
    if value is None:
        ttc = record.get('ttc') or {}
        name = ttc.get('name')
        if name == 'Bernoulli':
            args = ttc.get('arguments', [])
            if len(args) != 1:
                raise ValueError('Defense Bernoulli requires one probability')
            value = args[0]
        else:
            if name not in {None, 'Enabled', 'Disabled'}:
                raise ValueError(f'Unsupported defense TTC: {name!r}')
            value = 1.0 if name == 'Enabled' else 0.0
    probability = float(value)
    if not math.isfinite(probability) or not 0 <= probability <= 1:
        raise ValueError('Defense probability must be between 0 and 1')
    return probability


def load_graph(path):
    with open(path, encoding='utf-8-sig') as stream:
        document = yaml.safe_load(stream)
    if not isinstance(document, dict) or not isinstance(document.get('attack_steps'), dict):
        raise ValueError("Expected an 'attack_steps' mapping")
    if not document['attack_steps']:
        raise ValueError('The attack_steps mapping is empty')

    nodes, warnings = {}, []
    for full_name, record in document['attack_steps'].items():
        if not isinstance(full_name, str) or not isinstance(record, dict):
            raise ValueError('Each attack step must have a string name and mapping value')
        ident = node_id(record.get('id'))
        if ident in nodes:
            raise ValueError(f'Duplicate node ID: {ident}')
        kind = str(record.get('type', '')).lower()
        if kind == 'notexists':
            kind = 'notexist'
        if kind not in {'and', 'or', 'defense', 'exist', 'notexist'}:
            raise ValueError(f'Unsupported attack step type: {kind!r}')
        normalized = dict(record, id=ident, full_name=full_name, type=kind)
        normalized['asset'] = record.get('asset') or full_name.rsplit(':', 1)[0]
        normalized['is_necessary'] = boolean(record.get('is_necessary', True), f'{full_name}.is_necessary')
        if kind in {'exist', 'notexist'}:
            normalized['existence_status'] = boolean(record.get('existence_status'), f'{full_name}.existence_status')
        if kind == 'defense':
            normalized['defense_status'] = defense_probability(record)
        for field in ('parents', 'children'):
            if not isinstance(record.get(field, {}), dict):
                raise ValueError(f'{full_name}.{field} must be a mapping')
            normalized[field] = {}
        nodes[ident] = normalized

    child_edges, parent_edges = set(), set()
    for full_name, record in document['attack_steps'].items():
        ident = node_id(record['id'])
        for field, edges in (('children', child_edges), ('parents', parent_edges)):
            for reference, reference_name in record.get(field, {}).items():
                reference = node_id(reference)
                if reference not in nodes:
                    raise ValueError(f'Unknown node ID {reference} in {full_name}.{field}')
                if reference_name != nodes[reference]['full_name']:
                    warnings.append(f'ID {reference}: reference name {reference_name!r} differs; ID was used')
                edges.add((ident, reference) if field == 'children' else (reference, ident))
    if child_edges ^ parent_edges:
        warnings.append(f'{len(child_edges ^ parent_edges)} connection(s) appear only in parents or children; both mappings were merged')
    edges = sorted(child_edges | parent_edges, key=lambda edge: tuple(map(str, edge)))
    for source, target in edges:
        nodes[source]['children'][target] = nodes[target]['full_name']
        nodes[target]['parents'][source] = nodes[source]['full_name']
    return nodes, edges, list(dict.fromkeys(warnings))

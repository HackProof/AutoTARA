/**
 * @name keys
 * @description Adds key bindings to the graph
 */

import { useThreatModelStore } from '@/stores/threatModelStore.js';

const del = (graph) => () => graph.removeCells(graph.getSelectedCells());

const undo = (graph) => () => {
    if (!graph.getPlugin('history').canUndo()) {
        return false;
    }
    graph.getPlugin('history').undo();
};

const redo = (graph) => () => {
    if (!graph.getPlugin('history').canRedo()) {
        return false;
    }
    graph.getPlugin('history').redo();
};

const copy = (graph) => () => {
    const cells = graph.getSelectedCells();
    if (!cells || cells.length === 0) {
        return false;
    }
    graph.copy(cells);
};

const paste = (graph) => () => {
    if (graph.isClipboardEmpty()) {
        return false;
    }
    const cells = graph.paste({ offset: 32 });
    graph.cleanSelection();
    graph.select(cells);
};

const save = () => async (evt) => {
    const tmStore = useThreatModelStore();
    evt?.preventDefault();
    // tmStore.applyDiagram();
    console.log('[Graph Keys] Saving threat model via Ctrl+S');
    await tmStore.save();
};

const bind = (graph) => {
    graph.bindKey('del', del(graph));
    graph.bindKey('ctrl+z', undo(graph));
    graph.bindKey('ctrl+y', redo(graph));
    graph.bindKey('ctrl+c', copy(graph));
    graph.bindKey('ctrl+v', paste(graph));
    graph.bindKey('ctrl+s', save());
};

export default {
    bind
};

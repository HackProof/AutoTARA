import { Shape } from '@antv/x6';
import defaultProperties from '@/service/entity/default-properties.js';

const name = 'flow';

// data flow (edge)
export const Flow = Shape.Edge.define({
    constructorName: name,
    width: 200,
    height: 100,
    zIndex: 10,
    label: 'Data Flow',
    attrs: {
        line: {
            strokeWidth: 1.5,
            sourceMarker: null,
            targetMarker: null
        }
    },
    connector: 'smooth',
    data: defaultProperties.defaultData('tm.Flow')
});

Flow.prototype.type = 'tm.Flow';

Flow.prototype.setName = function(name) {
    this.setLabels([name]);
};

Flow.prototype.updateStyle = function(color, dash, strokeWidth) {
    this.setAttrByPath('line/stroke', color);
    this.setAttrByPath('line/strokeWidth', strokeWidth);
    this.setAttrByPath('line/strokeDasharray', dash);
    this.setAttrByPath('line/sourceMarker', null);
    this.setAttrByPath('line/targetMarker', null);
};

// a new edge (not flow) is created by AntV/X6 from an existing node port
// and then needs to be converted to a Flow
Flow.fromEdge = function(edge) {
    return new Flow({
        source: edge.getSource(),
        target: edge.getTarget(),
        data: edge.getData(),
        vertices: edge.getVertices()
    });
};

export default {
    Flow,
    name
};

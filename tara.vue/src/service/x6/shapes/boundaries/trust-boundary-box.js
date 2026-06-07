import { Shape } from '@antv/x6';
import defaultProperties from '@/service/entity/default-properties.js';

const name = 'trust-boundary-box';
const boundaryStroke = '#dc3545';
const boundaryDash = '10 5';
const boundaryStrokeWidth = 3;

// trust boundary box (dotted line, transparent background)
export const TrustBoundaryBox = Shape.Rect.define({
    shape: name,
    constructorName: name,
    overwrite: true,
    width: 500,
    height: 400,
    zIndex: 10,
    markup: [
        {
            tagName: 'rect',
            selector: 'body'
        },
        {
            tagName: 'text',
            selector: 'label'
        },
        {
            tagName: 'rect',
            selector: 'hitArea'
        }
    ],
    attrs: {
        body: {
            refWidth: '100%',
            refHeight: '100%',
            rx: 10,
            ry: 10,
            strokeWidth: boundaryStrokeWidth,
            strokeDasharray: boundaryDash,
            stroke: boundaryStroke,
            fill: 'transparent',
            fillOpacity: 0,
            opacity: 1,
            pointerEvents: 'visiblePainted'
        },
        label: {
            text: 'Trust Boundary',
            fill: boundaryStroke,
            fontWeight: 700,
            textAnchor: 'start',
            textVerticalAnchor: 'top',
            refX: 14,
            refY: 12,
            pointerEvents: 'none'
        },
        hitArea: {
            refWidth: '100%',
            refHeight: '100%',
            rx: 10,
            ry: 10,
            fill: '#ffffff',
            fillOpacity: 0,
            stroke: 'transparent',
            strokeWidth: 12,
            pointerEvents: 'all'
        }
    },
    data: defaultProperties.defaultData('tm.BoundaryBox')
});

TrustBoundaryBox.prototype.type = 'tm.BoundaryBox';

TrustBoundaryBox.prototype.setName = function (name) {
    this.setAttrByPath('label/text', name);
};

TrustBoundaryBox.prototype.updateStyle = function (color, dash, strokeWidth) {
    this.setAttrByPath('body/stroke', color || boundaryStroke);
    this.setAttrByPath('body/strokeWidth', strokeWidth || boundaryStrokeWidth);
    this.setAttrByPath('body/strokeDasharray', dash || boundaryDash);
    this.setAttrByPath('body/fill', 'transparent');
    this.setAttrByPath('body/fillOpacity', 0);
    this.setAttrByPath('body/opacity', 1);
    this.setAttrByPath('body/pointerEvents', 'visiblePainted');
    this.setAttrByPath('hitArea/refWidth', '100%');
    this.setAttrByPath('hitArea/refHeight', '100%');
    this.setAttrByPath('hitArea/fillOpacity', 0);
    this.setAttrByPath('hitArea/stroke', 'transparent');
    this.setAttrByPath('hitArea/strokeWidth', 12);
    this.setAttrByPath('hitArea/pointerEvents', 'all');
};

export default {
    name,
    TrustBoundaryBox
};

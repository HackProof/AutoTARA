import { Shape } from '@antv/x6';
import defaultProperties from '@/service/entity/default-properties.js';

const name = 'trust-boundary-curve';

// trust boundary curve (edge, dotted line, gray opaque background))
export const TrustBoundaryCurve = Shape.Edge.define({
    constructorName: name,
    width: 200,
    height: 100,
    zIndex: 10,
    label: 'Trust Boundary',
    attrs: {
        line: {
            strokeWidth: 3,
            strokeDasharray: '10 5',
            sourceMarker: null,
            targetMarker: null
        }
    },
    connector: 'smooth',
    data: defaultProperties.defaultData('tm.Boundary')
});

TrustBoundaryCurve.prototype.type = 'tm.Boundary';

TrustBoundaryCurve.prototype.setName = function (name) {
    this.setLabels([name]);
};

TrustBoundaryCurve.prototype.updateStyle = function () {};

export default {
    name,
    TrustBoundaryCurve
};

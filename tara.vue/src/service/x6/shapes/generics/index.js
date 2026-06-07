import { Graph } from '@antv/x6';

import { ActorShape } from './actor.js';
import { Flow } from './flow.js';
import { FlowStencil } from './flow-stencil.js';
import { ProcessShape } from './process.js';
import { StoreShape } from './store.js';
import { TextBlock } from '../metadata/text.js';
import { TrustBoundaryBox } from '../boundaries/trust-boundary-box.js';
import { TrustBoundaryCurve } from '../boundaries/trust-boundary-curve.js';
import { TrustBoundaryCurveStencil } from '../boundaries/trust-boundary-curve-stencil.js';

// this looks and is wrong, but a lot of existing models have this typo, so make compatible
Graph.registerNode('trust-broundary-curve', TrustBoundaryCurve);

Graph.registerNode('actor', ActorShape);
Graph.registerEdge('flow', Flow);
Graph.registerNode('process', ProcessShape);
Graph.registerNode('store', StoreShape);
Graph.registerNode('td-text-block', TextBlock);
Graph.registerEdge('trust-boundary-curve', TrustBoundaryCurve);

export default {
    ActorShape,
    Flow,
    FlowStencil,
    ProcessShape,
    StoreShape,
    TextBlock,
    TrustBoundaryBox,
    TrustBoundaryCurve,
    TrustBoundaryCurveStencil
};

const actor = {
    size: {
        width: 150,
        height: 80
    },
    label: 'Actor',
    shape: 'actor',
    zIndex: 0,
    data: {
        type: 'tm.Actor',
        isTrustBoundary: false,
        description: '',
        isEntry: false,
        isTarget: false,
        outOfScope: false,
        reasonOutOfScope: '',
        hasOpenThreats: false,
        providesAuthentication: false,
        threats: []
    }
};

const boundary = {
    attrs: {
        label: 'Trust Boundary'
    },
    shape: 'trust-boundary',
    zIndex: 10,
    data: {
        type: 'tm.Boundary',
        name: 'Trust Boundary',
        description: '',
        isTrustBoundary: true,
        hasOpenThreats: false
    }
};

const boundaryBox = {
    attrs: {
        label: {
            text: 'Trust Boundary',
            fill: '#dc3545',
            fontWeight: 700,
            textAnchor: 'start',
            textVerticalAnchor: 'top',
            refX: 14,
            refY: 12,
            pointerEvents: 'none'
        },
        body: {
            stroke: '#dc3545',
            strokeWidth: 3,
            strokeDasharray: '10 5',
            fill: 'transparent',
            fillOpacity: 0,
            opacity: 1,
            pointerEvents: 'visiblePainted'
        },
        hitArea: {
            refWidth: '100%',
            refHeight: '100%',
            fill: '#ffffff',
            fillOpacity: 0,
            stroke: 'transparent',
            strokeWidth: 12,
            pointerEvents: 'all'
        }
    },
    shape: 'trust-boundary-box',
    zIndex: 10,
    data: {
        type: 'tm.BoundaryBox',
        name: 'Trust Boundary',
        description: '',
        isTrustBoundary: true,
        hasOpenThreats: false
    }
};

const flow = {
    attrs: {
        line: {
            stroke: '#333333',
            strokeWidth: 1.5,
            targetMarker: {
                name: ''
            },
            sourceMarker: {
                name: ''
            },
            strokeDasharray: null
        }
    },
    shape: 'flow',
    width: 200,
    height: 100,
    labels: [
        {
            markup: [
                {
                    tagName: 'ellipse',
                    selector: 'labelBody'
                },
                {
                    tagName: 'text',
                    selector: 'labelText'
                }
            ],
            attrs: {
                labelText: {
                    text: '',
                    textAnchor: 'middle',
                    textVerticalAnchor: 'middle'
                },
                labelBody: {
                    ref: 'labelText',
                    refRx: '50%',
                    refRy: '60%',
                    fill: '#fff',
                    strokeWidth: 0
                }
            },
            position: {
                distance: 0.5,
                args: {
                    keepGradient: true,
                    ensureLegibility: true
                }
            }
        }
    ],

    connector: 'smooth',
    data: {
        type: 'tm.Flow',
        name: 'Data Flow',
        description: '',
        outOfScope: false,
        isTrustBoundary: false,
        reasonOutOfScope: '',
        hasOpenThreats: false,
        isBidirectional: false,
        isEncrypted: false,
        isPublicNetwork: false,
        protocol: '',
        threats: []
    },
    source: {cell: '', port: ''},
    target: {cell: '', port: ''},
    vertices: []
};

const process = {
    size: {
        width: 60,
        height: 60
    },
    attrs: {
        text: {
            text: 'Process',
        },
        body: {
            stroke: '#333333',
            strokeWidth: 1.5,
            strokeDasharray: null
        }
    },
    shape: 'process',
    zIndex: 0,
    data: {
        type: 'tm.Process',
        outOfScope: false,
        isTrustBoundary: false,
        description: '',
        isEntry: false,
        isTarget: false,
        reasonOutOfScope: '',
        hasOpenThreats: false,
        threats: []
    }
};

const store = {
    size: {
        width: 150,
        height: 75
    },
    attrs: {
        text: {
            text: 'Store',
        },
        topLine: {
            strokeWidth: 1.5,
            strokeDasharray: null
        },
        bottomLine: {
            strokeWidth: 1.5,
            strokeDasharray: null
        }
    },
    shape: 'store',
    zIndex: 0,
    data: {
        type: 'tm.Store',
        outOfScope: false,
        isTrustBoundary: false,
        description: '',
        isEntry: false,
        isTarget: false,
        reasonOutOfScope: '',
        hasOpenThreats: false,
        threats: []
    }
};

const text = {
    size: {
        width: 190,
        height: 80
    },
    shape: 'td-text-block',
    zIndex: 0,
    data: {
        type: 'tm.Text',
        name: 'Descriptive text',
        hasOpenThreats: false
    }
};

const propsByType = {
    'tm.Actor': actor,
    'tm.Boundary': boundary,
    'tm.BoundaryBox': boundaryBox,
    'tm.Flow': flow,
    'tm.FlowStencil': flow,
    'tm.Process': process,
    'tm.Store': store,
    'tm.Text': text
};

const defaultData = (type) => {
    console.log('defaultData for type: ' + type);
    if (!Object.keys(propsByType).some(x => x === type)) {
        throw new Error(`Unknown entity: ${type}`);
    }
    return JSON.parse(JSON.stringify(propsByType[type].data));
};

const defaultEntity = (type) => {
    if (!Object.keys(propsByType).some(x => x === type)) {
        throw new Error(`Unknown entity: ${type}`);
    }
    return JSON.parse(JSON.stringify(propsByType[type]));
};

export default {
    defaultData,
    defaultEntity
};

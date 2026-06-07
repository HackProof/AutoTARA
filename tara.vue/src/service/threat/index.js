import { v4 } from 'uuid';

export const createNewThreat = (number) => {
    return {
        id: v4(),
        attackStep: '',
        mitre_id: '',
        mitre_name: '',
        technique: 'New Threat',
        status: 'open', // open, mitigated
        description: '',
        riskScore: '3.3',  // TTP Risk Score
        new: true,
        number: number, // Sequential Threat Number
        ttc: 1, // Time-to-Compromise
        ttp_score: { },
        cve: [],
        selectedCMs: []
    };
};

export const createNewThreatWithMitre = (mitreTechnique, number) => {
    return {
        id: v4(),
        attackStep: mitreTechnique.attackStep || mitreTechnique.name,
        mitre_id: mitreTechnique.id,
        mitre_name: mitreTechnique.name,
        technique: mitreTechnique.attackStep || mitreTechnique.name,
        status: 'open', // open, mitigated
        description: mitreTechnique.description || '',
        riskScore: '3.3',  // TTP Risk Score
        new: false,
        number: number, // Sequential Threat Number
        ttc: 1, // Time-to-Compromise
        ttp_score: mitreTechnique.ttp_scoring || {},
        cve: [],
        selectedCMs: []
    };
}

export const hasOpenThreats = (data) => !!data && !!data.threats &&
    data.threats.filter(x => x.status.toLowerCase() === 'open').length > 0;

export default {
    createNewThreat,
    createNewThreatWithMitre,
    hasOpenThreats
}

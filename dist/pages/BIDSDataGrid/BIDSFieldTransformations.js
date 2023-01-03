/**
 * Handler for ensuring that the BolusCutOffDelayTime field changes type appropriately dependening on the value of
 * BolusCutOffDelayTimeTechnique
 */
export function BolusCutOffDelayTimeDependency(row) {
    const { BolusCutOffDelayTime, BolusCutOffTechnique } = row;
    // Early exit if a comparison between these two fields is not possible
    if (BolusCutOffDelayTime == undefined || BolusCutOffTechnique == undefined)
        return row;
    // Case 1: BolusCutOffDelayTimeTechnique is "Q2TIPS" and BolusCutOffDelayTime is a number
    if (BolusCutOffTechnique === "Q2TIPS" && typeof BolusCutOffDelayTime === "number") {
        const newValue = [BolusCutOffDelayTime, 0];
        return Object.assign(Object.assign({}, row), { BolusCutOffDelayTime: newValue });
    }
    // Case 2: BolusCutOffDelayTimeTechnique is not "Q2TIPS" and BolusCutOffDelayTime is an array
    if (BolusCutOffTechnique !== "Q2TIPS" && Array.isArray(BolusCutOffDelayTime)) {
        const newValue = BolusCutOffDelayTime[0];
        return Object.assign(Object.assign({}, row), { BolusCutOffDelayTime: newValue });
    }
    // 
    return row;
}
//# sourceMappingURL=BIDSFieldTransformations.js.map
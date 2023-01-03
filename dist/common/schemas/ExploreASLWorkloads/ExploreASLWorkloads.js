import { Mapping_1_10_0 } from "./Workload_V1_10_0";
import { Mapping_1_11_0 } from "./Workload_V1_11_0";
/**
 * A mapping of ExploreASL version to the corresponding expected workload for that version of ExploreASL.
 * - Keys are the basenames of ExploreASL version files
 * - Values are the workloads that should be expected.
 */
export const EASLWorkloadMapping = {
    "VERSION_1.10.0_BETA": Mapping_1_10_0,
    "VERSION_1.10.0": Mapping_1_10_0,
    "VERSION_1.10.1": Mapping_1_10_0,
    "VERSION_1.11.0_BETA": Mapping_1_11_0,
    "VERSION_1.11.0": Mapping_1_11_0,
    "VERSION_1.11.1": Mapping_1_11_0,
    "VERSION_1.12.0_BETA": Mapping_1_11_0,
    "VERSION_1.12.0": Mapping_1_11_0,
};
//# sourceMappingURL=ExploreASLWorkloads.js.map
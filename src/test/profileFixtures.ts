import type { MatlabProfile } from "../schemas/executionProfile";

export function makeMatlabProfile(overrides: Partial<MatlabProfile> = {}): MatlabProfile {
  return {
    id: overrides.id ?? "00000000-0000-4000-8000-000000000001",
    label: "Test MATLAB",
    type: "matlab",
    matlabPath: "/opt/matlab/bin/matlab",
    exploreAslPath: "/opt/ExploreASL",
    ...overrides,
  };
}

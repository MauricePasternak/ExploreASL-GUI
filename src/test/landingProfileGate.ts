import { DEFAULT_SETTINGS } from "../schemas/globalSettings";
import { useGlobalStore } from "../stores/globalStore";
import { makeMatlabProfile } from "./profileFixtures";

/** Seeds global store so landing page project actions are enabled in tests. */
export function seedValidProfileGate(profile = makeMatlabProfile()) {
  useGlobalStore.setState({
    loaded: true,
    settings: {
      ...DEFAULT_SETTINGS,
      executionProfiles: [profile],
    },
    profileValidationState: {
      [profile.id]: { valid: true, errors: [] },
    },
  });
  return profile;
}

export function seedInvalidProfileGate(profile = makeMatlabProfile()) {
  useGlobalStore.setState({
    loaded: true,
    settings: {
      ...DEFAULT_SETTINGS,
      executionProfiles: [profile],
    },
    profileValidationState: {
      [profile.id]: { valid: false, errors: ["MATLAB not found"] },
    },
  });
  return profile;
}

export function seedZeroProfilesGate() {
  useGlobalStore.setState({
    loaded: true,
    settings: DEFAULT_SETTINGS,
    profileValidationState: {},
  });
}

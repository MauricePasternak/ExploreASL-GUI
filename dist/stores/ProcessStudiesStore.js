import { atom } from "jotai";
import { range as lodashRange } from "lodash";
export const ProcessStudiesChannelBaseName = "EASLProcessStudies";
/**
 * Primitive atom representing the current tab that is selected in the Process Studies section of the GUI.
 */
export const atomProcStudyCurrentTab = atom("RunExploreASL");
export const atomProcStudyPIDs = atom([]);
/**
 * This is the store for each study of the Process Studies tab.
 * Each study's startup options are represented by a {@link RunEASLStudySetupType}:
 * - `studyRootPath`: The root path of the study on which ExploreASL is being run.
 * - `numberOfCores`: The number of cores to use for the ExploreASL run.
 * - `currentStatus`: The current status of the child process that is being run.
 * - `whichModulesToRun`: The ExploreASL modules that should be run.
 */
export const atomProcStudySetups = atom([
    {
        studyRootPath: "",
        numberOfCores: 1,
        currentStatus: "Standby",
        whichModulesToRun: "Structural",
    },
]);
/**
 * A getter atom meant to retrieve the list of study root paths
 */
export const atomStudyRootPathsByAllStudies = atom(get => get(atomProcStudySetups).map(setup => setup.studyRootPath));
/**
 * A getter atom meant to retrieve the all the current statuses of studies being run
 */
export const atomStudyStatusByAllStudies = atom(get => get(atomProcStudySetups).map(setup => setup.currentStatus));
/**
 * A getter atom meant to retrieve the number of cores used by all studies.
 */
export const atomNumCoresByAllStudies = atom(get => get(atomProcStudySetups).reduce((acc, studyParams) => {
    acc += studyParams.numberOfCores;
    return acc;
}, 0));
/**
 * A setter atom meant to modify the number of studies being run
 * Its setter function has params:
 * - `nStudiesSelection`: The number of studies that should be run by the ProcessStudies section of the GUI.
 */
export const atomAddOrRemoveStudy = atom(null, (get, set, nStudiesSelection) => {
    const oldStudies = get(atomProcStudySetups);
    const delta = nStudiesSelection - oldStudies.length;
    let newStudies = [];
    // Adding new studies
    if (delta > 0) {
        newStudies = [
            ...oldStudies,
            ...lodashRange(delta).map(() => ({
                studyRootPath: "",
                numberOfCores: 1,
                currentStatus: "Standby",
                whichModulesToRun: "Structural",
            })),
        ];
    }
    else {
        // Removing studies
        newStudies = [...oldStudies.slice(0, nStudiesSelection)];
    }
    set(atomProcStudySetups, newStudies);
});
/**
 * A setter atom meant to modify the number of cores used by a particular study.
 * Its setter function has params:
 * - `studyIndex`: The index of the study whose cores should be modified.
 * - `newNumberOfCores`: The new number of cores to use for the study.
 */
export const atomSetNumCoresForAStudy = atom(null, (get, set, updater) => {
    const newStudies = get(atomProcStudySetups).map((studySetup, studyIndex) => {
        return updater.studyIndex !== studyIndex ? studySetup : Object.assign(Object.assign({}, studySetup), { numberOfCores: updater.numberOfCores });
    });
    set(atomProcStudySetups, newStudies);
});
/**
 * A setter atom meant to modify the current modules to run for a particular study.
 * Its setter function has params:
 * - `studyIndex`: The index of the study whose modules should be modified.
 * - `newWhichModulesToRun`: The new modules to run for the study.
 */
export const atomSetModuleToRunForAStudy = atom(null, (get, set, updater) => {
    const newStudies = get(atomProcStudySetups).map((studySetup, studyIndex) => {
        return updater.studyIndex !== studyIndex ? studySetup : Object.assign(Object.assign({}, studySetup), { whichModulesToRun: updater.moduleToRun });
    });
    set(atomProcStudySetups, newStudies);
});
/**
 * A setter atom meant to modify the current status of a particular study.
 * Its setter function has params:
 * - `studyIndex`: The index of the study whose status should be modified.
 * - `newStatus`: The new status to use for the study.
 */
export const atomSetStatusForAStudy = atom(null, (get, set, updater) => {
    const newStudies = get(atomProcStudySetups).map((studySetup, studyIndex) => {
        return updater.studyIndex !== studyIndex ? studySetup : Object.assign(Object.assign({}, studySetup), { currentStatus: updater.status });
    });
    set(atomProcStudySetups, newStudies);
});
/**
 * A setter atom meant to modify the root path of a particular study.
 * Its setter function has params:
 * - `studyIndex`: The index of the study whose root path should be modified.
 * - `newStudyRootPath`: The new root path to use for the study.
 */
export const atomSetPathForAStudy = atom(null, (get, set, updater) => {
    const newStudies = get(atomProcStudySetups).map((studySetup, studyIndex) => {
        return updater.studyIndex !== studyIndex
            ? studySetup
            : Object.assign(Object.assign({}, studySetup), { studyRootPath: updater.newStudyRootPath });
    });
    set(atomProcStudySetups, newStudies);
});
//# sourceMappingURL=ProcessStudiesStore.js.map
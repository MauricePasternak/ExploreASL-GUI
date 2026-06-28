# Project Manifest

## Section 1: Study Parameters

### Group A

| Parameter | Value |
|-----------|-------|
| N Subjects | 2 |
| N Total Runs | 4 |
| Arterial Spin Labeling Type | PCASL |
| Labeling Duration | 1800 ms |
| Post Labeling Delay | 2000 ms |
| M0 Type | Separate |
| Background Suppression | true |

### Group B

| Parameter | Value |
|-----------|-------|
| N Subjects | 1 |
| N Total Runs | 2 |
| Arterial Spin Labeling Type | PASL |
| Post Labeling Delay | 1800 ms |
| Bolus Cut Off Flag | true |
| Bolus Cut Off Delay Time | 1000 ms |
| M0 Type | Included |
| Background Suppression | false |

### Ungrouped

| Parameter | Value |
|-----------|-------|
| N Subjects | 1 |
| N Total Runs | 1 |
| Arterial Spin Labeling Type | PCASL |
| Labeling Duration | 1500 ms |
| Post Labeling Delay | 1500 ms |
| M0 Type | Separate |
| Background Suppression | true |

## Section 2: Software Manifest

| Software | Version |
|----------|---------|
| ExploreASL | 1.0.0 |
| ExploreASL GUI | 0.1.0 |
| MATLAB | R2023b |

| Key | Value |
|-----|-------|
| x.Q.M0 | 1 |
| x.bPVCNativeSpace | 0 |
| x.SESSIONS | 01 |

## Section 3: QC Summary

### Group A

| Metric | Value |
|--------|-------|
| Pass / Total | 2 / 2 |
| Mean ASL Coverage % (SD) | 95.00 (3.54) |
| Mean Spatial CoV % (SD) | 8.50 (0.71) |
| Mean Motion (mm RMS) (SD) | 0.40 (0.14) |
| Mean Motion Exclusion % (SD) | 5.00 (4.24) |
| Fail Reasons | none |

### Group B

| Metric | Value |
|--------|-------|
| Pass / Total | 0 / 1 |
| Mean ASL Coverage % (SD) | N/A |
| Mean Spatial CoV % (SD) | N/A |
| Mean Motion (mm RMS) (SD) | N/A |
| Mean Motion Exclusion % (SD) | N/A |
| Fail Reasons | motion: 1 |

### Ungrouped

| Metric | Value |
|--------|-------|
| Pass / Total | 1 / 1 |
| Mean ASL Coverage % (SD) | 88.00 (N/A) |
| Mean Spatial CoV % (SD) | 10.00 (N/A) |
| Mean Motion (mm RMS) (SD) | 0.50 (N/A) |
| Mean Motion Exclusion % (SD) | 2.00 (N/A) |
| Fail Reasons | none |

## Section 4: Pipeline Summary

Data were processed with ExploreASL (version 1.0.0) running in MATLAB R2023b through the ExploreASL GUI (version 0.1.0). This manifest covers 4 subjects across 3 groups.
# Project Manifest

## Section 1: Study Parameters

### Group A

| Parameter | Value |
|-----------|-------|
| N Participants | 2 |
| N Subject-Sessions | 2 |
| N Total Runs | 4 |
| Arterial Spin Labeling Type | PCASL |
| Labeling Duration | 1800 ms |
| Post Labeling Delay | 2000 ms |
| M0 Type | Separate |
| Background Suppression | true |

### Group B

| Parameter | Value |
|-----------|-------|
| N Participants | 1 |
| N Subject-Sessions | 1 |
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
| N Participants | 1 |
| N Subject-Sessions | 1 |
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

### ExploreASL Data Parameter Configuration

Machine-local paths are redacted. Subject selection and inclusion settings are preserved.

```json
{
  "x.Q.M0": 1,
  "x.bPVCNativeSpace": 0,
  "x.SESSIONS": "01"
}
```

## Section 3: QC Summary

Pass / Total counts reviewed subject-sessions (participant visits), not unique participants, excluding No Info. Metric n counts final-Pass subject-sessions with an available value for that metric.

### Group A

| Metric | Value |
|--------|-------|
| Pass / Total (subject-sessions) | 2 / 2 |
| Mean ASL Coverage % (SD) | 95.00 (3.54); n=2 |
| Mean Spatial CoV % (SD) | 8.50 (0.71); n=2 |
| Mean Motion (mm RMS) (SD) | 0.40 (0.14); n=2 |
| Mean Motion Exclusion % (SD) | 5.00 (4.24); n=2 |
| Fail Reasons | none |

### Group B

| Metric | Value |
|--------|-------|
| Pass / Total (subject-sessions) | 0 / 1 |
| Mean ASL Coverage % (SD) | N/A; n=0 |
| Mean Spatial CoV % (SD) | N/A; n=0 |
| Mean Motion (mm RMS) (SD) | N/A; n=0 |
| Mean Motion Exclusion % (SD) | N/A; n=0 |
| Fail Reasons | motion: 1 |

### Ungrouped

| Metric | Value |
|--------|-------|
| Pass / Total (subject-sessions) | 1 / 1 |
| Mean ASL Coverage % (SD) | 88.00 (N/A); n=1 |
| Mean Spatial CoV % (SD) | 10.00 (N/A); n=1 |
| Mean Motion (mm RMS) (SD) | 0.50 (N/A); n=1 |
| Mean Motion Exclusion % (SD) | 2.00 (N/A); n=1 |
| Fail Reasons | none |

## Section 4: Pipeline Summary

This manifest covers 4 unique participants with 4 included subject-sessions across 3 groups.

### Methods

This Methods draft reflects the dataPar.json available when this manifest was generated. Authors should verify that it describes the processing performed before publication.

Images were processed with ExploreASL, described by Mutsaerts et al., 2020.

Initial dataset selection used the subject-selection expression "^sub-.*$". Structural processing was skipped for participant visits without a resolved T1w image.

T1w images underwent centre-of-mass initialization and alignment to the anterior commissure-posterior commissure orientation. CAT12 segmented T1w images into gray matter, white matter, and cerebrospinal fluid partial volume maps, as described by Gaser, 2009. SPM12 segmentation provided a fallback if CAT12 failed. For participant visits with FLAIR images, white matter hyperintensities were segmented with the Lesion Segmentation Toolbox using LPA, as described by Schmidt et al., 2012, and de Sitter et al., 2017a. Existing WMH maps took precedence over new segmentation, and previous LPA or LGA outputs could determine the algorithm. CAT12 normalized tissue maps to standard space using its geodesic shooting or DARTEL registration workflow.

Eligible ASL time series underwent SPM12 realignment with a zig-zag regressor for control-label contrast differences, as described by Wang, 2012. Realignment required multiple frames per echo and did not apply to Look-Locker or subtraction-only input. For eligible single-delay, single-echo data, control-label pairs with motion above an absolute threshold of 0 mm were removed. Outlier exclusion was disabled for multi-delay and multi-echo data. ASL alignment used control-to-T1w registration followed by CBF-to-pseudo-CBF attempts according to image contrast, as described by Mutsaerts et al., 2018. When mean control images were unavailable, M0 could supply the initial registration contrast. M0 processing, M0 scale-slope correction, M0 relaxation correction, and division by M0 were disabled. Quantification included manufacturer-specific ASL scaling, label-intensity conversion with kinetic modeling, and final scaling where applicable to the acquisition. When native label-intensity conversion was enabled, single-delay quantification used a single-compartment kinetic model, as described by Alsop et al., 2015. The blood-brain partition coefficient was 0.9 mL/g. Quantification used an arterial blood T1 of 1650 ms. Gray matter T1 was 1240 ms.

Regional statistics were extracted for qCBF in standard space. Each image type used the following atlas choices. Tissue criteria applied only to tissue-masked ASL extraction: Whole Brain Grey and White Matter with GM partial volume greater than 0.7; Deep White Matter with WM partial volume greater than 0.7. For standard-space extraction, susceptibility masks excluded regions affected by signal dropout. Vascular masks excluded intravascular signal from regional mean estimates. Whole-brain masks constrained extraction to brain tissue. For ASL image types, tissue masks constrained extraction using the specified partial volumes. Tissue masking was disabled for non-ASL image types. Where WMH maps were available, their contributions were subtracted from tissue partial volumes. The minimum ROI volume was 1 mL for ordinary atlas extraction.

### References

- Alsop, D. C., Detre, J. A., Golay, X., Günther, M., Hendrikse, J., Hernandez-Garcia, L., Lu, H., MacIntosh, B. J., Parkes, L. M., Smits, M., van Osch, M. J. P., Wang, D. J. J., Wong, E. C., & Zaharchuk, G. (2015). Recommended implementation of arterial spin-labeled perfusion MRI for clinical applications: a consensus of the ISMRM perfusion study group and the European consortium for ASL in Dementia. Magnetic Resonance in Medicine, 73(1), 102–116.
- de Sitter, A., Steenwijk, M. D., Ruet, A., Versteeg, A., Liu, Y., van Schijndel, R. A., Pouwels, P. J. W., et al. (2017a). Performance of five research-domain automated WM lesion segmentation methods in a multi-center MS study. NeuroImage, 163, 106–114.
- Gaser, C. (2009). Partial volume segmentation with adaptive maximum a posteriori (MAP) approach. NeuroImage, 47(1), S39–S41.
- Mutsaerts, H. J. M. M., Petr, J., Groot, P., Vandemaele, P., Ingala, S., Robertson, A. D., ... & Barkhof, F. (2020). ExploreASL: An image processing pipeline for multi-center ASL perfusion MRI studies. NeuroImage, 219, 117031.
- Mutsaerts, H. J. M. M., Petr, J., Thomas, D. L., De Vita, E., Cash, D. M., van Osch, M. J. P., Golay, X., et al. (2018). Comparison of arterial spin labeling registration strategies in the multi-center GENetic frontotemporal Dementia initiative (GENFI). Journal of Magnetic Resonance Imaging, 47(1), 131–140.
- Schmidt, P., Gaser, C., Arsic, M., Buck, D., Förschler, A., Berthele, A., Hoshi, M., et al. (2012). An automated tool for detection of FLAIR-hyperintense white-matter lesions in multiple sclerosis. NeuroImage, 59(4), 3774–3783.
- Wang, Z. (2012). Improving cerebral blood flow quantification for arterial spin labeled perfusion MRI by removing residual motion artifacts and global signal fluctuations. Magnetic Resonance Imaging, 30(10), 1409–1415.

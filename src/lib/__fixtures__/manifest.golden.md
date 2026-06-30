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

### ExploreASL Data Parameter Configuration

```json
{
  "x.Q.M0": 1,
  "x.bPVCNativeSpace": 0,
  "x.SESSIONS": "01"
}
```

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

### Methods

Results included in this manuscript come from preprocessing performed using ExploreASL 1.0.0 (Mutsaerts et al., 2020), which is based on MATLAB and Statistical Parametric Mapping 12 (SPM12, version 7219; Ashburner, 2012; Flandin and Friston, 2008). Data import and conversion to a Brain Imaging Data Structure (BIDS; Gorgolewski et al., 2016) compatible format were performed using dcm2niiX (Li et al., 2016).

Anatomical structural images were automatically oriented and aligned along the Anterior Commissure – Posterior Commissure (AC-PC) line. The structural images were segmented into gray matter (GM), white matter (WM), and cerebrospinal fluid (CSF) partial volume maps using the Computational Anatomy Toolbox 12 (CAT12, release 1363; Gaser, 2009). Volume-based spatial normalization to the 1.5 mm isotropic IXI555-MNI152 standard space (Evans et al., 2012) was executed through non-linear registration using Geodesic Shooting (Ashburner and Friston, 2011).

ASL time-series were corrected for head motion using an adapted SPM12 realignment algorithm incorporating a 'zig-zag' regressor to minimize apparent motion driven by control-label intensity differences (Wang, 2012). Motion spikes and acquisition artifacts were removed using the threshold-free Enhancement of Automated BLood flow Estimates (ENABLE) method (Shirzadi et al., 2015), which cumulatively averages control-label pairs to optimize temporal signal-to-noise ratio. Spike removal utilized a Z-score threshold of 0.01 and an absolute threshold of 0. Registration between ASL and structural spaces was initialized with an M0-to-T1w alignment, followed by a rigid-body registration of the perfusion-weighted image (AM) to the GM partial volume map (PGM) (Mutsaerts et al., 2018).

Analysis masks were generated to exclude voxels with intravascular signal—identified via clusters of negative or extreme positive apparent CBF (Maumet et al., 2012)—and regions affected by susceptibility-induced signal dropout. Cerebral blood flow (CBF) was quantified using ExploreASL's native implementation of the recommended single-compartment model (Alsop et al., 2015). Assumed physiological parameters included a blood-brain partition coefficient of 0.9 mL/g, arterial blood T1 of 1650 ms, and gray matter T1 of 1240 ms.

Regional CBF statistics were extracted by intersecting individual subject masks with standard brain atlases, including Whole Brain Grey and White Matter and Deep White Matter. Atlas regions were constrained using a tissue probability threshold of 0.7, 0.7, masked specifically to GM, WM. Regions occupying less than 1 mL in a given subject were excluded from statistical extraction to ensure sufficient signal-to-noise ratio.

### References

- Alsop, D. C., Detre, J. A., Golay, X., Günther, M., Hendrikse, J., Hernandez-Garcia, L., Lu, H., MacIntosh, B. J., Parkes, L. M., Smits, M., van Osch, M. J. P., Wang, D. J. J., Wong, E. C., & Zaharchuk, G. (2015). Recommended implementation of arterial spin-labeled perfusion MRI for clinical applications: a consensus of the ISMRM perfusion study group and the European consortium for ASL in Dementia. Magnetic Resonance in Medicine, 73(1), 102–116.
- Ashburner, J., & Friston, K. J. (2011). Diffeomorphic registration using geodesic shooting and Gauss-Newton optimisation. NeuroImage, 55(3), 954–967.
- Ashburner, J. (2012). SPM: a history. NeuroImage, 62(2), 791–800.
- Evans, A. C., Janke, A. L., Collins, D. L., & Baillet, S. (2012). Brain templates and atlases. NeuroImage, 62(2), 911–922.
- Flandin, G., & Friston, K. (2008). Statistical parametric mapping (SPM). Scholarpedia, 3(4), 6232.
- Gaser, C. (2009). Partial volume segmentation with adaptive maximum a posteriori (MAP) approach. NeuroImage, 47(1), S39–S41.
- Gorgolewski, K. J., Auer, T., Calhoun, V. D., Craddock, R. C., Das, S., Duff, E. P., Flandin, G., et al. (2016). The brain imaging data structure, a format for organizing and describing outputs of neuroimaging experiments. Scientific Data, 3, 160044.
- Li, X., Morgan, P. S., Ashburner, J., Smith, J., & Rorden, C. (2016). The first step for neuroimaging data analysis: DICOM to NIfTI conversion. Journal of Neuroscience Methods, 264, 47–56.
- Maumet, C., Maurel, P., Ferré, J.-C., Bannier, E., & Barillot, C. (2012). Using negative signal in mono-TI pulsed arterial spin labeling to outline pathological increases in arterial transit times. ISMRM Scientific Workshop, 40, p. 42.
- Mutsaerts, H. J. M. M., Petr, J., Thomas, D. L., De Vita, E., Cash, D. M., van Osch, M. J. P., Golay, X., et al. (2018). Comparison of arterial spin labeling registration strategies in the multi-center GENetic frontotemporal Dementia initiative (GENFI). Journal of Magnetic Resonance Imaging, 47(1), 131–140.
- Mutsaerts, H. J. M. M., Petr, J., Groot, P., Vandemaele, P., Ingala, S., Robertson, A. D., ... & Barkhof, F. (2020). ExploreASL: An image processing pipeline for multi-center ASL perfusion MRI studies. NeuroImage, 219, 117031.
- Shirzadi, Z., Crane, D. E., Robertson, A. D., Maralani, P. J., Aviv, R. I., Chappell, M. A., Goldstein, B. I., Black, S. E., & MacIntosh, B. J. (2015). Automated removal of spurious intermediate cerebral blood flow volumes improves image quality among older patients: a clinical arterial spin labeling investigation. Journal of Magnetic Resonance Imaging, 42(5), 1377–1385.
- Wang, Z. (2012). Improving cerebral blood flow quantification for arterial spin labeled perfusion MRI by removing residual motion artifacts and global signal fluctuations. Magnetic Resonance Imaging, 30(10), 1409–1415.

import type { DataParState } from "../schemas/dataParSchema";
import { ATLAS_DISPLAY_LABELS } from "./dataParFieldMetadata";

export const REFERENCE_DICTIONARY: Record<string, string> = {
  "Alsop 2015":
    "Alsop, D. C., Detre, J. A., Golay, X., Günther, M., Hendrikse, J., Hernandez-Garcia, L., Lu, H., MacIntosh, B. J., Parkes, L. M., Smits, M., van Osch, M. J. P., Wang, D. J. J., Wong, E. C., & Zaharchuk, G. (2015). Recommended implementation of arterial spin-labeled perfusion MRI for clinical applications: a consensus of the ISMRM perfusion study group and the European consortium for ASL in Dementia. Magnetic Resonance in Medicine, 73(1), 102–116.",
  "Ashburner 2011":
    "Ashburner, J., & Friston, K. J. (2011). Diffeomorphic registration using geodesic shooting and Gauss-Newton optimisation. NeuroImage, 55(3), 954–967.",
  "Ashburner 2012": "Ashburner, J. (2012). SPM: a history. NeuroImage, 62(2), 791–800.",
  "Ashburner 2012b":
    "Ashburner, J., & Ridgway, G. R. (2012). Symmetric diffeomorphic modeling of longitudinal structural MRI. Frontiers in Neuroscience, 6, 197.",
  "Asllani 2008":
    "Asllani, I., Borogovac, A., & Brown, T. R. (2008). Regression algorithm correcting for partial volume effects in arterial spin labeling MRI. Magnetic Resonance in Medicine, 60(6), 1362–1371.",
  "Battaglini 2012":
    "Battaglini, M., Jenkinson, M., & De Stefano, N. (2012). Evaluating and reducing the impact of white matter lesions on brain volume measurements. Human Brain Mapping, 33(9), 2062–2071.",
  "de Sitter 2017a":
    "de Sitter, A., Steenwijk, M. D., Ruet, A., Versteeg, A., Liu, Y., van Schijndel, R. A., Pouwels, P. J. W., et al. (2017a). Performance of five research-domain automated WM lesion segmentation methods in a multi-center MS study. NeuroImage, 163, 106–114.",
  "Evans 2012":
    "Evans, A. C., Janke, A. L., Collins, D. L., & Baillet, S. (2012). Brain templates and atlases. NeuroImage, 62(2), 911–922.",
  "Flandin 2008":
    "Flandin, G., & Friston, K. (2008). Statistical parametric mapping (SPM). Scholarpedia, 3(4), 6232.",
  "Gaser 2009":
    "Gaser, C. (2009). Partial volume segmentation with adaptive maximum a posteriori (MAP) approach. NeuroImage, 47(1), S39–S41.",
  "Gorgolewski 2016":
    "Gorgolewski, K. J., Auer, T., Calhoun, V. D., Craddock, R. C., Das, S., Duff, E. P., Flandin, G., et al. (2016). The brain imaging data structure, a format for organizing and describing outputs of neuroimaging experiments. Scientific Data, 3, 160044.",
  "Hales 2016":
    "Hales, P. W., tissue, F. J., & Clark, C. A. (2016). A general model to calculate the spin-lattice (T1) relaxation time of blood, accounting for haematocrit, oxygen saturation and magnetic field strength. J. Cereb. Blood Flow Metab. 36(2), 370–374.",
  "Li 2016":
    "Li, X., Morgan, P. S., Ashburner, J., Smith, J., & Rorden, C. (2016). The first step for neuroimaging data analysis: DICOM to NIfTI conversion. Journal of Neuroscience Methods, 264, 47–56.",
  "Maumet 2012":
    "Maumet, C., Maurel, P., Ferré, J.-C., Bannier, E., & Barillot, C. (2012). Using negative signal in mono-TI pulsed arterial spin labeling to outline pathological increases in arterial transit times. ISMRM Scientific Workshop, 40, p. 42.",
  "Mutsaerts 2018":
    "Mutsaerts, H. J. M. M., Petr, J., Thomas, D. L., De Vita, E., Cash, D. M., van Osch, M. J. P., Golay, X., et al. (2018). Comparison of arterial spin labeling registration strategies in the multi-center GENetic frontotemporal Dementia initiative (GENFI). Journal of Magnetic Resonance Imaging, 47(1), 131–140.",
  "Mutsaerts 2020":
    "Mutsaerts, H. J. M. M., Petr, J., Groot, P., Vandemaele, P., Ingala, S., Robertson, A. D., ... & Barkhof, F. (2020). ExploreASL: An image processing pipeline for multi-center ASL perfusion MRI studies. NeuroImage, 219, 117031.",
  "Oliver 2015":
    "Oliver, R. A. (2015). Improved Quantification of Arterial Spin Labelling Images Using Partial Volume Correction Techniques. UCL (University College London).",
  "Petr 2018a":
    "Petr, J., Mutsaerts, H. J. M., De Vita, E., ... & Asllani, I. (2018a). Effects of systematic partial volume errors on the estimation of gray matter cerebral blood flow with arterial spin labeling MRI. MAGMA. 31(6), 725–734.",
  "Schmidt 2012":
    "Schmidt, P., Gaser, C., Arsic, M., Buck, D., Förschler, A., Berthele, A., Hoshi, M., et al. (2012). An automated tool for detection of FLAIR-hyperintense white-matter lesions in multiple sclerosis. NeuroImage, 59(4), 3774–3783.",
  "Shirzadi 2015":
    "Shirzadi, Z., Crane, D. E., Robertson, A. D., Maralani, P. J., Aviv, R. I., Chappell, M. A., Goldstein, B. I., Black, S. E., & MacIntosh, B. J. (2015). Automated removal of spurious intermediate cerebral blood flow volumes improves image quality among older patients: a clinical arterial spin labeling investigation. Journal of Magnetic Resonance Imaging, 42(5), 1377–1385.",
  "Vaclavu 2016":
    "Vaclavu, L., van der Land, V., Heijtel, D. F. R., van Osch, M. J. P., ... & Majoie, C. B. L. M. (2016). In vivo T1 of blood measurements in children with sickle cell disease improve cerebral blood flow quantification from arterial spin-labeling MRI. AJNR Am. J. Neuroradiol. 37(9), 1727–1732.",
  "Wang 2012":
    "Wang, Z. (2012). Improving cerebral blood flow quantification for arterial spin labeled perfusion MRI by removing residual motion artifacts and global signal fluctuations. Magnetic Resonance Imaging, 30(10), 1409–1415.",
};

export interface MethodsParagraphResult {
  paragraphs: string[];
  references: string[];
}

function mergeSections(
  target: Record<string, unknown>,
  source: Record<string, unknown> | undefined,
): void {
  if (!source) return;
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined) {
      target[key] = value;
    }
  }
}

/**
 * Flatten nested ExploreASL dataPar.json (x.Q, x.modules.*, etc.) into flat GUI keys.
 * Tolerates already-flat input.
 */
export function flattenRunDataPar(
  nested: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (!nested || Object.keys(nested).length === 0) {
    return {};
  }

  const x = nested.x as Record<string, unknown> | undefined;
  if (!x) {
    return { ...nested };
  }

  const flat: Record<string, unknown> = {};
  mergeSections(flat, x.Q as Record<string, unknown> | undefined);
  mergeSections(
    flat,
    (x.modules as Record<string, unknown> | undefined)?.asl as Record<string, unknown> | undefined,
  );
  mergeSections(
    flat,
    (x.modules as Record<string, unknown> | undefined)?.structural as
      Record<string, unknown> | undefined,
  );
  mergeSections(flat, x.settings as Record<string, unknown> | undefined);
  mergeSections(flat, x.S as Record<string, unknown> | undefined);
  mergeSections(flat, x.external as Record<string, unknown> | undefined);

  if (x.bAutomaticallyDetectFSL !== undefined) {
    flat.bAutomaticallyDetectFSL = x.bAutomaticallyDetectFSL;
  }
  if (x.bAutomaticallyDetectVABY !== undefined) {
    flat.bAutomaticallyDetectVABY = x.bAutomaticallyDetectVABY;
  }

  return flat;
}

function joinParagraph(sentences: string[]): string {
  return sentences.filter(Boolean).join(" ");
}

function formatListWithAnd(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function formatMappedAtlases(atlases: string[]): string {
  const labels = atlases.map((key) => ATLAS_DISPLAY_LABELS[key] ?? key);
  return formatListWithAnd(labels);
}

function formatKernelTuple(kernel: unknown): string {
  if (!Array.isArray(kernel) || kernel.length < 3) {
    return "5x5x1";
  }
  return `${kernel[0]}x${kernel[1]}x${kernel[2]}`;
}

function nCompartmentsLabel(value: unknown): string {
  if (value === 2) return "dual-compartment";
  return "single-compartment";
}

function getMaskingIndices(state: DataParState): [number, number] {
  const masking = state.bMasking ?? [1, 1, 1, 1];
  return [Number(masking[0]), Number(masking[1])];
}

function isSeparateScanM0(m0: unknown): boolean {
  return m0 === "separate_scan" || typeof m0 === "number";
}

function sortedReferences(refIds: Set<string>): string[] {
  return [...refIds]
    .sort((a, b) => a.localeCompare(b))
    .map((id) => REFERENCE_DICTIONARY[id])
    .filter(Boolean);
}

function generateArtifact1(state: DataParState, refs: Set<string>): string {
  const sentences: string[] = [];

  refs.add("Mutsaerts 2020");
  refs.add("Ashburner 2012");
  refs.add("Flandin 2008");
  sentences.push(
    "Results included in this manuscript come from preprocessing performed using ExploreASL 1.0.0 (Mutsaerts et al., 2020), which is based on MATLAB and Statistical Parametric Mapping 12 (SPM12, version 7219; Ashburner, 2012; Flandin and Friston, 2008).",
  );

  if (state.Quality === 0) {
    sentences.push(
      "Processing was executed in a low-quality, fast try-out mode with fewer iterations and lower spatial resolution for rapid testing purposes.",
    );
  }

  refs.add("Gorgolewski 2016");
  refs.add("Li 2016");
  sentences.push(
    "Data import and conversion to a Brain Imaging Data Structure (BIDS; Gorgolewski et al., 2016) compatible format were performed using dcm2niiX (Li et al., 2016).",
  );

  return joinParagraph(sentences);
}

function generateArtifact2(state: DataParState, refs: Set<string>): string {
  const sentences: string[] = [];
  const useDummyStructural = state.bUseMNIasDummyStructural === 1;

  if (state.bAutoACPC !== false) {
    sentences.push(
      "Anatomical structural images were automatically oriented and aligned along the Anterior Commissure – Posterior Commissure (AC-PC) line.",
    );
  }

  if (useDummyStructural) {
    sentences.push(
      "Due to the absence of individual T1-weighted structural scans, the standard MNI template was utilized as a dummy structural reference to facilitate spatial normalization and proxy tissue segmentation.",
    );
    return joinParagraph(sentences);
  }

  if (state.bFixResolution === true) {
    sentences.push(
      "High-resolution structural scans were automatically resampled to a standard 1 mm isotropic resolution prior to tissue segmentation to ensure pipeline consistency.",
    );
  }

  if (state.bLesionFilling === true) {
    const wmhAlg = state.WMHsegmAlg ?? "LPA";
    refs.add("Battaglini 2012");
    refs.add("Schmidt 2012");
    refs.add("de Sitter 2017a");
    sentences.push(
      `White matter hyperintensities (WMH) were segmented on fluid-attenuated inversion recovery (FLAIR) images and used to fill corresponding hypointensities on T1-weighted (T1w) images to improve segmentation accuracy by preventing misclassification of WMH as gray matter (Battaglini et al., 2012). This lesion-filling procedure was performed using the ${wmhAlg} algorithm within the Lesion Segmentation Toolbox (LST, version 2.0.15; Schmidt et al., 2012; de Sitter et al., 2017a).`,
    );
  }

  if (state.bSegmentSPM12 === 1) {
    sentences.push(
      "The structural images were segmented into gray matter (GM), white matter (WM), and cerebrospinal fluid (CSF) partial volume maps utilizing standard SPM12 unified tissue segmentation.",
    );
  } else {
    refs.add("Gaser 2009");
    sentences.push(
      "The structural images were segmented into gray matter (GM), white matter (WM), and cerebrospinal fluid (CSF) partial volume maps using the Computational Anatomy Toolbox 12 (CAT12, release 1363; Gaser, 2009).",
    );
  }

  if (state.bHammersCAT12 === 1) {
    sentences.push("The Hammers brain atlas parcellation was automatically generated via CAT12.");
  }

  const normalizationParts: string[] = [];
  refs.add("Evans 2012");
  refs.add("Ashburner 2011");
  normalizationParts.push(
    "Volume-based spatial normalization to the 1.5 mm isotropic IXI555-MNI152 standard space (Evans et al., 2012) was executed through non-linear registration using Geodesic Shooting (Ashburner and Friston, 2011).",
  );

  if (state.bRunDARTEL === 1) {
    normalizationParts.push(
      "High-dimensional diffeomorphic registration (DARTEL) was enabled to precisely align structural images to standard space.",
    );
  }

  if (state.bRunLongReg === 1) {
    refs.add("Ashburner 2012b");
    normalizationParts.push(
      "To track within-subject anatomical changes across multiple timepoints, the SPM12 module for longitudinal registration was applied utilizing the first timepoint as a reference (Ashburner and Ridgway, 2012).",
    );
  }

  sentences.push(joinParagraph(normalizationParts));
  return joinParagraph(sentences);
}

function generateArtifact3(state: DataParState, refs: Set<string>): string {
  const sentences: string[] = [];

  if (state.motionCorrection === 1 || state.motionCorrection === undefined) {
    refs.add("Wang 2012");
    sentences.push(
      "ASL time-series were corrected for head motion using an adapted SPM12 realignment algorithm incorporating a 'zig-zag' regressor to minimize apparent motion driven by control-label intensity differences (Wang, 2012).",
    );
  }

  const spikeThreshold = state.SpikeRemovalThreshold ?? 0.01;
  const spikeAbsolute = state.SpikeRemovalAbsoluteThreshold ?? 0;
  refs.add("Shirzadi 2015");
  sentences.push(
    `Motion spikes and acquisition artifacts were removed using the threshold-free Enhancement of Automated BLood flow Estimates (ENABLE) method (Shirzadi et al., 2015), which cumulatively averages control-label pairs to optimize temporal signal-to-noise ratio. Spike removal utilized a Z-score threshold of ${spikeThreshold} and an absolute threshold of ${spikeAbsolute}.`,
  );

  if (state.bTopUp === true) {
    sentences.push(
      "Geometric distortions typical of EPI or GRASE readouts were corrected using FSL TopUp based on calibration scans acquired with reversed phase-encoding directions.",
    );
  }

  if (state.bRegistrationContrast === 1) {
    sentences.push(
      "Registration between ASL and structural spaces was performed using the M0 calibration scan directly aligned to the T1w structural scan.",
    );
  } else if (state.bDCTRegistration === 1) {
    refs.add("Petr 2018a");
    sentences.push(
      "Registration between ASL and structural spaces was initialized with an M0-to-T1w alignment, followed by a non-linear discrete cosine transform (DCT) registration of the perfusion-weighted image to the GM partial volume map (Petr et al., 2018a).",
    );
  } else if (state.bAffineRegistration === 1) {
    sentences.push(
      "Registration between ASL and structural spaces was initialized with an M0-to-T1w alignment, followed by an affine registration of the perfusion-weighted image to the GM partial volume map.",
    );
  } else {
    refs.add("Mutsaerts 2018");
    sentences.push(
      "Registration between ASL and structural spaces was initialized with an M0-to-T1w alignment, followed by a rigid-body registration of the perfusion-weighted image (AM) to the GM partial volume map (PGM) (Mutsaerts et al., 2018).",
    );
  }

  const m0 = state.M0;
  if (isSeparateScanM0(m0)) {
    let m0Text: string;
    if (state.M0_conventionalProcessing === 1) {
      m0Text =
        "The M0 calibration scan was processed conventionally without spatial smoothing or WM-mask-based rescaling.";
    } else {
      const scaleFactor = state.M0_GMScaleFactor ?? 1;
      m0Text = `The equilibrium magnetization (M0) image was processed by smoothing with a 16 mm full-width at half-maximum (FWHM) Gaussian kernel, masking for WM, and rescaling to the mean GM M0 (utilizing a scale factor of ${scaleFactor}) to create a smooth bias field that cancels out sequence-specific B1-field inhomogeneities.`;
    }
    if (state.bRegisterM02ASL === 1) {
      m0Text +=
        " To correct for inter-scan head movement, the M0 calibration scan was rigidly registered to the ASL space prior to quantification.";
    }
    sentences.push(m0Text);
  } else if (m0 === "UseControlAsM0") {
    sentences.push(
      "The equilibrium magnetization (M0) was estimated directly from the ASL control images to cancel out sequence-specific inhomogeneities.",
    );
  } else if (m0 !== "Absent" && m0 !== undefined) {
    sentences.push(
      "Equilibrium magnetization (M0) was calibrated using a custom user-defined strategy.",
    );
  }

  return joinParagraph(sentences);
}

function generateArtifact4(state: DataParState, refs: Set<string>): string {
  const sentences: string[] = [];
  const [mask0, mask1] = getMaskingIndices(state);

  if (mask0 === 1 && mask1 === 1) {
    refs.add("Maumet 2012");
    sentences.push(
      "Analysis masks were generated to exclude voxels with intravascular signal—identified via clusters of negative or extreme positive apparent CBF (Maumet et al., 2012)—and regions affected by susceptibility-induced signal dropout.",
    );
  } else if (mask0 === 1 && mask1 !== 1) {
    sentences.push(
      "Analysis masks were generated to exclude regions affected by susceptibility-induced signal dropout.",
    );
  } else if (mask0 !== 1 && mask1 === 1) {
    refs.add("Maumet 2012");
    sentences.push(
      "Analysis masks were generated to exclude voxels with intravascular signal—identified via clusters of negative or extreme positive apparent CBF (Maumet et al., 2012).",
    );
  }

  if (state.bUseExternalQuantification === true) {
    const extType = state.ExternalQuantificationType ?? "BASIL";
    let quantText = `Cerebral blood flow (CBF) external quantification was enabled utilizing the ${extType} toolbox.`;

    if (extType === "BASIL") {
      if (state.bSpatialBASIL === true) {
        quantText +=
          " Spatial regularization was applied during quantification to improve signal coherence across neighboring voxels.";
      }
      if (state.bInferT1BASIL === true) {
        quantText +=
          " The model dynamically inferred local T1 relaxation values rather than relying on fixed physiological assumptions.";
      }
      if (state.bInferATTBASIL === true) {
        const attSd = state.ATTSDBASIL ?? 1.0;
        quantText += ` The model dynamically estimated the arterial transit time (ATT) with a prior standard deviation assumption of ${attSd}.`;
      }
    }
    sentences.push(quantText);
  } else {
    const compartments = nCompartmentsLabel(state.nCompartments);
    const lambda = state.Lambda ?? 0.9;
    const t1blood = state.T1blood ?? 1650;
    const t1gm = state.T1GM ?? 1240;
    refs.add("Alsop 2015");
    let quantText = `Cerebral blood flow (CBF) was quantified using ExploreASL's native implementation of the recommended ${compartments} model (Alsop et al., 2015). Assumed physiological parameters included a blood-brain partition coefficient of ${lambda} mL/g, arterial blood T1 of ${t1blood} ms, and gray matter T1 of ${t1gm} ms.`;

    if ((state.bHct2BloodT1 ?? 0) > 0) {
      refs.add("Hales 2016");
      refs.add("Vaclavu 2016");
      quantText +=
        " To avoid CBF overestimation, arterial blood T1 was dynamically computed based on individual hematocrit values rather than assuming a fixed literature baseline (Hales et al., 2016; Vaclavu et al., 2016).";
    }
    sentences.push(quantText);
  }

  if (state.bPVCNativeSpace === 1) {
    const kernelType = state.bPVCGaussianMM === 1 ? "Gaussian" : "flat";
    const kernelDims = formatKernelTuple(state.PVCNativeSpaceKernel);
    refs.add("Asllani 2008");
    refs.add("Oliver 2015");
    sentences.push(
      `Partial volume correction (PVC) was applied in native space using a linear regression algorithm (Asllani et al., 2008). This was implemented utilizing a 3D ${kernelType} kernel with dimensions of ${kernelDims} mm along the Left-Right (LR), Anterior-Posterior (AP), and Inferior-Superior (IS) axes (Oliver, 2015) to correct for the low spatial resolution of ASL and the distinct CBF properties of GM and WM.`,
    );
  }

  return joinParagraph(sentences);
}

function generateArtifact5(state: DataParState): string {
  const sentences: string[] = [];
  const atlases = state.Atlases;
  const hasAtlases = atlases != null && atlases.length > 0;

  if (hasAtlases) {
    sentences.push(
      `Regional CBF statistics were extracted by intersecting individual subject masks with standard brain atlases, including ${formatMappedAtlases(atlases)}.`,
    );

    if (
      state.TissueMasking != null &&
      state.TissueThreshold != null &&
      state.TissueMasking.length > 0 &&
      state.TissueThreshold.length > 0
    ) {
      sentences.push(
        `Atlas regions were constrained using a tissue probability threshold of ${state.TissueThreshold.join(", ")}, masked specifically to ${state.TissueMasking.join(", ")}.`,
      );
    }
  }

  const minRoi = state.MinimalROIVolume;
  if (minRoi != null && minRoi > 0) {
    sentences.push(
      `Regions occupying less than ${minRoi} mL in a given subject were excluded from statistical extraction to ensure sufficient signal-to-noise ratio.`,
    );
  }

  if (state.bWMH === true) {
    sentences.push(
      "Automated detection and regional statistical extraction of white-matter hyperintensities were also performed.",
    );
  }

  return joinParagraph(sentences);
}

/**
 * Generate dynamic Methods paragraphs and sorted reference list from a complete flat dataPar.
 */
export function generateMethodsParagraph(state: DataParState): MethodsParagraphResult {
  const refs = new Set<string>();
  const paragraphs: string[] = [];

  const artifact1 = generateArtifact1(state, refs);
  if (artifact1) paragraphs.push(artifact1);

  const artifact2 = generateArtifact2(state, refs);
  if (artifact2) paragraphs.push(artifact2);

  const artifact3 = generateArtifact3(state, refs);
  if (artifact3) paragraphs.push(artifact3);

  const artifact4 = generateArtifact4(state, refs);
  if (artifact4) paragraphs.push(artifact4);

  const artifact5 = generateArtifact5(state);
  if (artifact5) paragraphs.push(artifact5);

  return {
    paragraphs,
    references: sortedReferences(refs),
  };
}

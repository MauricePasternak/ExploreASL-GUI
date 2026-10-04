use crate::processing::identifiers::*;

// -------------------------------------------------------------------------
// module_index_to_name
// -------------------------------------------------------------------------

#[test]
fn module_index_to_name_maps_0_to_structural() {
    assert_eq!(module_index_to_name(0), "xASL_module_Structural");
}

#[test]
fn module_index_to_name_maps_1_to_asl() {
    assert_eq!(module_index_to_name(1), "xASL_module_ASL");
}

#[test]
fn module_index_to_name_maps_2_to_population() {
    assert_eq!(module_index_to_name(2), "xASL_module_Population");
}

#[test]
#[should_panic(expected = "Invalid module index")]
fn module_index_to_name_panics_on_invalid_index() {
    module_index_to_name(3);
}

// -------------------------------------------------------------------------

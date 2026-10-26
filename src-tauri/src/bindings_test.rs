use super::*;
use tauri_specta::{BuilderConfiguration, LanguageExt};

struct CheckRegistry;

impl LanguageExt for CheckRegistry {
    type Error = std::io::Error;

    fn export(self, config: &BuilderConfiguration, _: &Path) -> Result<(), Self::Error> {
        assert_eq!(config.error_handling, ErrorHandlingMode::Result);
        assert!(config.dangerously_cast_bigints_to_number);
        assert!(
            config
                .typed_error_impl
                .contains("async function typedError")
        );
        let names: std::collections::HashSet<_> = config
            .commands
            .iter()
            .map(|command| command.name())
            .collect();
        assert_eq!(names.len(), config.commands.len());
        Ok(())
    }
}

#[test]
fn registry_keeps_dispatch_and_result_contract_together() {
    command_registry()
        .export(CheckRegistry, Path::new(""))
        .unwrap();
}

#[test]
fn numeric_newtypes_keep_validated_literal_wire_shapes() {
    use crate::project::model::{NumericFlag, SchemaVersion};
    let types = specta::Types::default()
        .register::<SchemaVersion>()
        .register::<NumericFlag>();
    let output = Typescript::export(&Typescript::default(), &types, specta_serde::Format).unwrap();
    assert!(output.contains("export type SchemaVersion = 2;"));
    assert!(output.contains("export type NumericFlag = 0 | 1;"));
    assert_eq!(serde_json::to_string(&SchemaVersion).unwrap(), "2");
    assert_eq!(
        serde_json::to_string(&NumericFlag::try_from(1).unwrap()).unwrap(),
        "1"
    );
    assert!(serde_json::from_str::<SchemaVersion>("1").is_err());
    assert!(serde_json::from_str::<NumericFlag>("2").is_err());
}

#[test]
fn project_wire_shapes_preserve_optional_nullable_and_json_fields() {
    use crate::project::model::{
        DataPar, ImportUiState, LastRun, MappingState, VisualizationConfig,
    };
    let types = specta::Types::default()
        .register::<MappingState>()
        .register::<ImportUiState>()
        .register::<VisualizationConfig>()
        .register::<LastRun>()
        .register::<DataPar>();
    let mut json_types = json_wire_types();
    json_types.extend(&types);
    let output = Typescript::export(
        &Typescript::default(),
        &json_types,
        specta_serde::PhasesFormat,
    )
    .unwrap();
    assert!(output.contains("sourceDataPath?: string,"), "{output}");
    assert!(
        output.contains("mostRecentConfig: ImportSnapshot_Serialize | null"),
        "{output}"
    );
    assert!(output.contains("qcbfSource: QcbfSource | null"), "{output}");
    assert!(output.contains("Mtime: number | null"), "{output}");
    assert!(
        output.contains("BackgroundSuppressionNumberPulses?: number,"),
        "{output}"
    );
    assert!(
        output.contains("PVCNativeSpaceKernel?: [number, number, number]"),
        "{output}"
    );
    assert!(output.contains("[key in string]"), "{output}");
}

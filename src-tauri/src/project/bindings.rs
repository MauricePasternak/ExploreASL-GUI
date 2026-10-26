//! Literal wire types for Serde's validated numeric newtypes.
use specta::{Type, Types, datatype::DataType};

pub struct SchemaVersionWire;

impl Type for SchemaVersionWire {
    fn definition(_: &mut Types) -> DataType {
        DataType::Reference(specta_typescript::define("2"))
    }
}

pub struct NumericFlagWire;

impl Type for NumericFlagWire {
    fn definition(_: &mut Types) -> DataType {
        DataType::Reference(specta_typescript::define("0 | 1"))
    }
}

//! Numeric poker engine. Card and range text belongs in Python or JavaScript.
pub mod evaluator;
#[cfg(feature = "python")]
mod python;
pub mod simulation;
#[cfg(feature = "wasm")]
mod wasm;

use crate::{
    evaluator::{self, Game},
    simulation::{self, CompiledRange, MonteCarloSession, Options},
};
use std::sync::Arc;
use wasm_bindgen::prelude::*;

fn js_error(e: impl std::fmt::Display) -> JsValue {
    JsValue::from_str(&e.to_string())
}
fn serialize(value: &impl Serialize) -> Result<JsValue, JsValue> {
    value
        .serialize(
            &serde_wasm_bindgen::Serializer::new().serialize_large_number_types_as_bigints(true),
        )
        .map_err(js_error)
}
#[wasm_bindgen]
pub fn evaluate_high(cards: &[u8]) -> Result<u32, JsValue> {
    evaluator::evaluate_high(cards).map_err(js_error)
}
#[wasm_bindgen]
pub fn evaluate(game: u8, hole: &[u8], board: &[u8]) -> Result<Vec<u32>, JsValue> {
    let v = evaluator::evaluate(Game::from_id(game).map_err(js_error)?, hole, board)
        .map_err(js_error)?;
    Ok(vec![v.high, v.low])
}
/// Receives only numeric masks/weights; parsing card/range text stays in JS.
#[wasm_bindgen]
pub struct NumericCalculator {
    ranges: Vec<Arc<CompiledRange>>,
    game: Game,
}
#[wasm_bindgen]
impl NumericCalculator {
    #[wasm_bindgen(constructor)]
    pub fn new(game: u8, ranges: JsValue) -> Result<Self, JsValue> {
        let game = Game::from_id(game).map_err(js_error)?;
        let ranges: Vec<Vec<(u64, f64)>> =
            serde_wasm_bindgen::from_value(ranges).map_err(js_error)?;
        let ranges = ranges
            .iter()
            .map(|r| CompiledRange::new(game, r))
            .collect::<Result<_, _>>()
            .map_err(js_error)?;
        Ok(Self { ranges, game })
    }
    #[allow(clippy::too_many_arguments)] // Numeric wasm-bindgen boundary; host API uses an options object.
    pub fn equity(
        &self,
        board: &[u8],
        dead: &[u8],
        exact: bool,
        samples: u64,
        seed: u64,
        max_exact: u64,
        max_attempts: u64,
    ) -> Result<JsValue, JsValue> {
        let opt = Options {
            game: self.game,
            exact,
            samples,
            seed,
            max_exact,
            max_attempts,
            threads: 1,
        };
        let result = simulation::simulate(&self.ranges, board, dead, &opt).map_err(js_error)?;
        serialize(&result)
    }
    pub fn start(
        &self,
        board: &[u8],
        dead: &[u8],
        samples: u64,
        seed: u64,
        max_attempts: u64,
    ) -> Result<NumericSimulation, JsValue> {
        let opt = Options {
            game: self.game,
            samples,
            seed,
            max_attempts,
            ..Options::default()
        };
        let inner = MonteCarloSession::new(&self.ranges, board, dead, &opt).map_err(js_error)?;
        Ok(NumericSimulation { inner })
    }
}
#[wasm_bindgen]
pub struct NumericSimulation {
    inner: MonteCarloSession,
}
#[wasm_bindgen]
impl NumericSimulation {
    #[wasm_bindgen(getter)]
    pub fn done(&self) -> bool {
        self.inner.done()
    }
    pub fn step(&mut self, samples: u32) -> Result<JsValue, JsValue> {
        self.inner.step(samples as u64).map_err(js_error)?;
        serialize(&self.inner.result().map_err(js_error)?)
    }
}
use serde::Serialize;

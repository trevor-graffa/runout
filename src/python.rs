use crate::{
    evaluator::{self, Error, Game},
    simulation::{self, CompiledRange, Options},
};
use pyo3::{
    exceptions::{PyRuntimeError, PyValueError},
    prelude::*,
    types::{PyDict, PyList, PyModule},
};
use std::sync::Arc;

impl From<Error> for PyErr {
    fn from(e: Error) -> Self {
        if e.limit {
            PyRuntimeError::new_err(e.message)
        } else {
            PyValueError::new_err(e.message)
        }
    }
}
#[pyclass(name = "CompiledRange", frozen)]
struct PyRange {
    inner: Arc<CompiledRange>,
}
#[pyfunction]
fn compile_range(py: Python<'_>, game: u8, entries: Vec<(u64, f64)>) -> PyResult<PyRange> {
    let game = Game::from_id(game)?;
    let inner = py.detach(|| CompiledRange::new(game, &entries))?;
    Ok(PyRange { inner })
}
#[pyfunction]
fn evaluate_high(cards: Vec<u8>) -> PyResult<u32> {
    Ok(evaluator::evaluate_high(&cards)?)
}
#[pyfunction]
fn evaluate(game: u8, hole: Vec<u8>, board: Vec<u8>) -> PyResult<(u32, u32)> {
    let v = evaluator::evaluate(Game::from_id(game)?, &hole, &board)?;
    Ok((v.high, v.low))
}
#[pyfunction]
fn initialize_omaha(bytes: &[u8]) -> PyResult<()> {
    Ok(evaluator::initialize_omaha_bytes(bytes)?)
}
#[pyfunction]
#[allow(clippy::too_many_arguments)]
fn simulate(
    py: Python<'_>,
    ranges: &Bound<'_, PyAny>,
    board: Vec<u8>,
    dead: Vec<u8>,
    game: u8,
    exact: bool,
    samples: u64,
    seed: u64,
    max_exact: u64,
    max_attempts: u64,
    threads: usize,
) -> PyResult<Py<PyDict>> {
    let game = Game::from_id(game)?;
    let compiled = ranges
        .try_iter()?
        .map(|item| {
            let item = item?;
            if let Ok(r) = item.extract::<PyRef<PyRange>>() {
                Ok(r.inner.clone())
            } else {
                Ok(CompiledRange::new(
                    game,
                    &item.extract::<Vec<(u64, f64)>>()?,
                )?)
            }
        })
        .collect::<PyResult<Vec<_>>>()?;
    let opt = Options {
        game,
        exact,
        samples,
        seed,
        max_exact,
        max_attempts,
        threads,
    };
    let result = py.detach(|| simulation::simulate(&compiled, &board, &dead, &opt))?;
    py.check_signals()?;
    let players = PyList::empty(py);
    for p in result.players {
        let row = PyDict::new(py);
        for (key, value) in [
            ("equity", p.equity),
            ("stderr", p.stderr),
            ("win", p.win),
            ("tie", p.tie),
            ("loss", p.loss),
            ("high_win", p.high_win),
            ("high_tie", p.high_tie),
            ("low_win", p.low_win),
            ("low_tie", p.low_tie),
        ] {
            row.set_item(key, value)?;
        }
        players.append(row)?;
    }
    let out = PyDict::new(py);
    out.set_item("players", players)?;
    out.set_item("outcomes", result.outcomes)?;
    out.set_item("attempts", result.attempts)?;
    Ok(out.unbind())
}
#[pymodule]
fn _native(m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add_class::<PyRange>()?;
    m.add_function(wrap_pyfunction!(compile_range, m)?)?;
    m.add_function(wrap_pyfunction!(evaluate_high, m)?)?;
    m.add_function(wrap_pyfunction!(evaluate, m)?)?;
    m.add_function(wrap_pyfunction!(simulate, m)?)?;
    m.add_function(wrap_pyfunction!(initialize_omaha, m)?)?;
    m.add("BACKEND", "rust")?;
    Ok(())
}

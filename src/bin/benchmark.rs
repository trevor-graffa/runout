// Uses the production evaluator source; prepared internals remain private to the library.
#[path = "../evaluator.rs"]
#[allow(dead_code)]
mod evaluator;
use evaluator::{Game, Hand, Prepared};
use std::{hint::black_box, time::Instant};

fn bench(name: &str, count: usize, repeats: usize, mut f: impl FnMut(usize) -> u64) {
    let start = Instant::now();
    let mut checksum = 0u64;
    for _ in 0..repeats {
        for i in 0..count {
            checksum += black_box(f(black_box(i)));
        }
    }
    println!(
        "{name} {} {checksum}",
        (count * repeats) as f64 / start.elapsed().as_secs_f64()
    );
}
fn main() {
    let args: Vec<_> = std::env::args().collect();
    let data = std::fs::read(&args[1]).unwrap();
    let count: usize = args[2].parse().unwrap();
    let repeats: usize = args[3].parse().unwrap();
    assert!(count > 0 && repeats > 0 && data.len() >= count * 9);
    evaluator::initialize(Game::Omaha8);
    let t = evaluator::tables();
    let omaha = evaluator::omaha_for(Game::Omaha8);
    let he: Vec<_> = data
        .as_chunks::<9>()
        .0
        .iter()
        .take(count)
        .map(|c| {
            (
                Prepared::hole(Game::Holdem, &c[5..7], t),
                Prepared::board(Game::Holdem, &c[..5], t),
            )
        })
        .collect();
    let om: Vec<_> = data
        .as_chunks::<9>()
        .0
        .iter()
        .take(count)
        .map(|c| {
            (
                Prepared::hole(Game::Omaha8, &c[5..], t),
                Prepared::board(Game::Omaha8, &c[..5], t),
            )
        })
        .collect();
    // Same seven cards as the C++ raw path: first five board cards, then two hole cards.
    bench("holdem_checked", count, repeats, |i| {
        evaluator::evaluate_high(&data[i * 9..i * 9 + 7]).unwrap() as u64
    });
    bench("holdem_prepared", count, repeats, |i| {
        evaluator::prepared_value(Game::Holdem, he[i].0, he[i].1, t, &[]).high as u64
    });
    bench("omaha_checked", count, repeats, |i| {
        evaluator::evaluate(
            Game::Omaha,
            &data[i * 9 + 5..i * 9 + 9],
            &data[i * 9..i * 9 + 5],
        )
        .unwrap()
        .high as u64
    });
    bench("omaha_prepared", count, repeats, |i| {
        evaluator::prepared_value(Game::Omaha, om[i].0, om[i].1, t, omaha).high as u64
    });
    bench("omaha8_checked", count, repeats, |i| {
        let v = evaluator::evaluate(
            Game::Omaha8,
            &data[i * 9 + 5..i * 9 + 9],
            &data[i * 9..i * 9 + 5],
        )
        .unwrap();
        v.high as u64 + v.low as u64
    });
    let _ = std::mem::size_of::<Hand>();
}

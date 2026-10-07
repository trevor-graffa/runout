use _native::{
    evaluator::{evaluate, evaluate_high, Game},
    simulation::{simulate, CompiledRange, Options, Rng},
};
use std::collections::HashSet;

#[test]
fn exhaustive_five_card_categories_and_strengths() {
    let mut counts = [0u64; 9];
    let mut scores = HashSet::new();
    for a in 0u8..48 {
        for b in a + 1..49 {
            for c in b + 1..50 {
                for d in c + 1..51 {
                    for e in d + 1..52 {
                        let score = evaluate_high(&[a, b, c, d, e]).unwrap();
                        counts[(score >> 20) as usize] += 1;
                        scores.insert(score);
                    }
                }
            }
        }
    }
    assert_eq!(
        counts,
        [1302540, 1098240, 123552, 54912, 10200, 5108, 3744, 624, 40]
    );
    assert_eq!(scores.len(), 7462);
}
#[test]
fn quartered_omaha8_and_weighted_joint_conditioning() {
    let mask = |ids: &[u8]| ids.iter().fold(0, |m, &c| m | 1u64 << c);
    let hero = CompiledRange::new(
        Game::Holdem,
        &[(mask(&[51, 50]), 2.), (mask(&[47, 46]), 1.)],
    )
    .unwrap();
    let villain = CompiledRange::new(
        Game::Holdem,
        &[(mask(&[51, 49]), 3.), (mask(&[43, 41]), 1.)],
    )
    .unwrap();
    let exact = Options {
        exact: true,
        ..Options::default()
    };
    let result = simulate(
        &[hero.clone(), villain.clone()],
        &[0, 5, 10, 27, 28],
        &[],
        &exact,
    )
    .unwrap();
    assert_eq!(result.outcomes, 3);
    assert!((result.players[0].equity - 0.5).abs() < 1e-12);
    let mc = Options {
        samples: 100000,
        seed: 11,
        threads: 4,
        ..Options::default()
    };
    let result = simulate(&[hero, villain], &[0, 5, 10, 27, 28], &[], &mc).unwrap();
    assert!((result.players[0].equity - 0.5).abs() < 5. * result.players[0].stderr);
    assert_eq!(
        evaluate(Game::Omaha8, &[51, 0, 45, 46], &[5, 10, 15, 40, 41])
            .unwrap()
            .low,
        0x54321
    );
}
#[test]
fn rejects_invalid_cards_and_games() {
    assert!(evaluate_high(&[52, 1, 2, 3, 4]).is_err());
    assert!(evaluate_high(&[1, 1, 2, 3, 4]).is_err());
    assert!(Game::from_id(3).is_err());
    assert!(CompiledRange::new(Game::Holdem, &[(3, 1.), (3, 2.)]).is_err());
}
#[test]
fn bounded_rng_is_reproducible_and_covers_small_deck() {
    let mut a = Rng::new(0);
    let mut b = Rng::new(0);
    let mut counts = [0usize; 52];
    for _ in 0..520000 {
        let i = a.bounded(52);
        assert_eq!(i, b.bounded(52));
        counts[i] += 1;
    }
    assert!(counts.iter().all(|&n| (9500..10500).contains(&n)));
}

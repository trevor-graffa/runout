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

fn combos(k: usize, filter: impl Fn(u64) -> bool) -> Vec<(u64, f64)> {
    fn rec(start: u8, k: usize, mask: u64, out: &mut Vec<u64>) {
        if k == 0 {
            out.push(mask);
            return;
        }
        for c in start..52 {
            rec(c + 1, k - 1, mask | 1u64 << c, out);
        }
    }
    let mut all = Vec::new();
    rec(0, k, 0, &mut all);
    all.into_iter()
        .filter(|&m| filter(m))
        .map(|m| (m, 1.))
        .collect()
}
fn mask(ids: &[u8]) -> u64 {
    ids.iter().fold(0, |m, &c| m | 1u64 << c)
}
fn compare_exact(game: Game, ranges: &[std::sync::Arc<CompiledRange>], board: &[u8]) {
    let exact = simulate(
        ranges,
        board,
        &[],
        &Options {
            game,
            exact: true,
            max_exact: 200_000_000,
            ..Options::default()
        },
    )
    .unwrap();
    let mc = simulate(
        ranges,
        board,
        &[],
        &Options {
            game,
            samples: 400_000,
            seed: 5,
            ..Options::default()
        },
    )
    .unwrap();
    for (e, m) in exact.players.iter().zip(&mc.players) {
        assert!(
            (e.equity - m.equity).abs() < 4. * m.stderr,
            "exact {} mc {} se {}",
            e.equity,
            m.equity,
            m.stderr
        );
    }
}
#[test]
fn free_players_match_exact_enumeration() {
    let river = [0u8, 5, 10, 27, 30];
    let hero = CompiledRange::new(Game::Holdem, &[(mask(&[51, 50]), 1.)]).unwrap();
    let random = CompiledRange::new(Game::Holdem, &combos(2, |_| true)).unwrap();
    compare_exact(
        Game::Holdem,
        &[hero.clone(), random.clone(), random.clone()],
        &river,
    );
    // narrow range, free player, and a wide non-free range together
    let narrow = CompiledRange::new(
        Game::Holdem,
        &[
            (mask(&[51, 50]), 1.),
            (mask(&[49, 48]), 1.),
            (mask(&[40, 41]), 1.),
        ],
    )
    .unwrap();
    let wide =
        CompiledRange::new(Game::Holdem, &combos(2, |m| m.trailing_zeros() % 3 == 0)).unwrap();
    compare_exact(Game::Holdem, &[narrow, random, wide], &river);
    for game in [Game::Omaha, Game::Omaha8] {
        let hero = CompiledRange::new(game, &[(mask(&[51, 50, 44, 40]), 1.)]).unwrap();
        let random = CompiledRange::new(game, &combos(4, |_| true)).unwrap();
        compare_exact(game, &[hero, random], &[0, 5, 10, 27]);
    }
}
#[test]
fn eight_player_omaha8_with_free_players_is_fast() {
    let hero_cards: Vec<_> = combos(4, |m| {
        // AA:xxyy style: two aces plus two cards of two other suits
        (m & 0xF).count_ones() == 2 && (m & 0xFF).count_ones() == 2 + (m & 0xF0).count_ones()
    });
    assert!(!hero_cards.is_empty());
    let hero = CompiledRange::new(Game::Omaha8, &hero_cards).unwrap();
    let random = CompiledRange::new(Game::Omaha8, &combos(4, |_| true)).unwrap();
    let mut ranges = vec![hero];
    ranges.extend(std::iter::repeat_n(random, 7));
    let start = std::time::Instant::now();
    let r = simulate(
        &ranges,
        &[],
        &[],
        &Options {
            game: Game::Omaha8,
            samples: 10_000,
            seed: 3,
            ..Options::default()
        },
    )
    .unwrap();
    assert_eq!(r.outcomes, 10_000);
    assert_eq!(r.attempts, 10_000);
    assert!(start.elapsed().as_secs_f64() < 5.);
}

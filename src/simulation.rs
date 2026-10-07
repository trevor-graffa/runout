use crate::evaluator::{
    cards_mask, initialize, mask_cards, omaha_for, prepared_value, tables, Error, Game, Prepared,
    Value,
};
use serde::Serialize;
use std::{collections::HashSet, sync::Arc};

#[derive(Clone)]
struct Combo {
    mask: u64,
    weight: f64,
    prepared: Prepared,
}
pub struct CompiledRange {
    game: Game,
    combos: Vec<Combo>,
    union_mask: u64,
    alias: Option<Alias>,
}
struct Alias {
    probability: Vec<f64>,
    index: Vec<usize>,
}
impl Alias {
    fn new(combos: &[Combo]) -> Option<Self> {
        if combos.iter().all(|c| c.weight == combos[0].weight) {
            return None;
        }
        let n = combos.len();
        let total: f64 = combos.iter().map(|c| c.weight).sum();
        let mut scaled: Vec<_> = combos.iter().map(|c| c.weight / total * n as f64).collect();
        let (mut small, mut large): (Vec<_>, Vec<_>) = (0..n).partition(|&i| scaled[i] < 1.0);
        let mut a = Self {
            probability: vec![1.; n],
            index: (0..n).collect(),
        };
        while !small.is_empty() && !large.is_empty() {
            let s = small.pop().unwrap();
            let l = large.pop().unwrap();
            a.probability[s] = scaled[s];
            a.index[s] = l;
            scaled[l] += scaled[s] - 1.;
            if scaled[l] < 1. {
                small.push(l);
            } else {
                large.push(l);
            }
        }
        Some(a)
    }
}
impl CompiledRange {
    pub fn new(game: Game, entries: &[(u64, f64)]) -> Result<Arc<Self>, Error> {
        if entries.is_empty() {
            return Err(Error::invalid("A player range is empty after card removal"));
        }
        let max = entries.iter().map(|c| c.1).fold(0., f64::max);
        let mut seen = HashSet::with_capacity(entries.len());
        let mut combos = Vec::with_capacity(entries.len());
        let mut union_mask = 0;
        let t = tables();
        for &(mask, weight) in entries {
            if mask >> 52 != 0 || mask.count_ones() as usize != game.hole_size() {
                return Err(Error::invalid(
                    "Range combo has invalid card mask or hole-card count",
                ));
            }
            if !weight.is_finite() || weight <= 0. {
                return Err(Error::invalid("Combo weights must be finite and positive"));
            }
            if !seen.insert(mask) {
                return Err(Error::invalid("Duplicate range combo"));
            }
            let weight = weight / max;
            if weight == 0. {
                return Err(Error::invalid(
                    "Weight dynamic range exceeds floating-point precision",
                ));
            }
            let prepared = Prepared::hole(game, &mask_cards(mask), t);
            combos.push(Combo {
                mask,
                weight,
                prepared,
            });
            union_mask |= mask;
        }
        let alias = Alias::new(&combos);
        Ok(Arc::new(Self {
            game,
            combos,
            union_mask,
            alias,
        }))
    }
    pub fn len(&self) -> usize {
        self.combos.len()
    }
    pub fn is_empty(&self) -> bool {
        self.combos.is_empty()
    }
    fn filtered(self: &Arc<Self>, blocked: u64) -> Result<Arc<Self>, Error> {
        if self.union_mask & blocked == 0 {
            return Ok(self.clone());
        }
        let combos: Vec<_> = self
            .combos
            .iter()
            .filter(|c| c.mask & blocked == 0)
            .cloned()
            .collect();
        if combos.is_empty() {
            return Err(Error::invalid("A player range is empty after card removal"));
        }
        let union_mask = combos.iter().fold(0, |m, c| m | c.mask);
        let alias = Alias::new(&combos);
        Ok(Arc::new(Self {
            game: self.game,
            combos,
            union_mask,
            alias,
        }))
    }
    #[inline]
    fn draw(&self, rng: &mut Rng) -> &Combo {
        let i = rng.bounded(self.combos.len() as u32);
        let index = match &self.alias {
            Some(a) if rng.unit() >= a.probability[i] => a.index[i],
            _ => i,
        };
        &self.combos[index]
    }
}
// xoshiro256++ with SplitMix64 seeding, identical on native and wasm. Sampling
// uses rejection-based bounded integers, never biased remainder arithmetic.
pub struct Rng([u64; 4]);
impl Rng {
    pub fn new(mut seed: u64) -> Self {
        Self(std::array::from_fn(|_| {
            seed = seed.wrapping_add(0x9e3779b97f4a7c15);
            let mut z = seed;
            z = (z ^ (z >> 30)).wrapping_mul(0xbf58476d1ce4e5b9);
            z = (z ^ (z >> 27)).wrapping_mul(0x94d049bb133111eb);
            z ^ (z >> 31)
        }))
    }
    #[inline]
    pub fn next_u64(&mut self) -> u64 {
        let s = &mut self.0;
        let result = s[0].wrapping_add(s[3]).rotate_left(23).wrapping_add(s[0]);
        let t = s[1] << 17;
        s[2] ^= s[0];
        s[3] ^= s[1];
        s[1] ^= s[2];
        s[0] ^= s[3];
        s[2] ^= t;
        s[3] = s[3].rotate_left(45);
        result
    }
    #[inline]
    pub fn bounded(&mut self, n: u32) -> usize {
        let threshold = n.wrapping_neg() % n;
        loop {
            let product = (self.next_u64() >> 32).wrapping_mul(n as u64);
            if product as u32 >= threshold {
                return (product >> 32) as usize;
            }
        }
    }
    #[inline]
    fn unit(&mut self) -> f64 {
        (self.next_u64() >> 11) as f64 * (1. / ((1u64 << 53) as f64))
    }
}

#[derive(Clone, Debug)]
pub struct Options {
    pub game: Game,
    pub exact: bool,
    pub samples: u64,
    pub seed: u64,
    pub max_exact: u64,
    pub max_attempts: u64,
    pub threads: usize,
}
impl Default for Options {
    fn default() -> Self {
        Self {
            game: Game::Holdem,
            exact: false,
            samples: 100000,
            seed: 0,
            max_exact: 2000000,
            max_attempts: 0,
            threads: 1,
        }
    }
}
#[derive(Clone, Copy, Default, Debug, Serialize)]
pub struct PlayerResult {
    pub equity: f64,
    pub stderr: f64,
    pub win: f64,
    pub tie: f64,
    pub loss: f64,
    pub high_win: f64,
    pub high_tie: f64,
    pub low_win: f64,
    pub low_tie: f64,
}
#[derive(Debug, Serialize)]
pub struct ResultData {
    pub players: Vec<PlayerResult>,
    pub outcomes: u64,
    pub attempts: u64,
}
#[derive(Clone)]
struct Acc {
    stats: [[f64; 9]; 10],
    mass: f64,
    log_scale: f64,
    outcomes: u64,
    attempts: u64,
    players: usize,
}
impl Acc {
    fn new(players: usize) -> Self {
        Self {
            stats: [[0.; 9]; 10],
            mass: 0.,
            log_scale: f64::NEG_INFINITY,
            outcomes: 0,
            attempts: 0,
            players,
        }
    }
    fn add_log(&mut self, values: &[Value], log_weight: f64) {
        if log_weight > self.log_scale {
            let scale = (self.log_scale - log_weight).exp();
            for row in &mut self.stats {
                for v in row {
                    *v *= scale;
                }
            }
            self.mass *= scale;
            self.log_scale = log_weight;
        }
        self.add(
            values,
            if log_weight == self.log_scale {
                1.
            } else {
                (log_weight - self.log_scale).exp()
            },
        );
    }
    #[inline]
    fn add(&mut self, values: &[Value], weight: f64) {
        let high = values.iter().map(|v| v.high).max().unwrap();
        let low = values
            .iter()
            .map(|v| v.low)
            .filter(|&l| l != 0)
            .min()
            .unwrap_or(0);
        let nh = values.iter().filter(|v| v.high == high).count();
        let nl = values.iter().filter(|v| low != 0 && v.low == low).count();
        for (i, v) in values.iter().enumerate() {
            let h = v.high == high;
            let l = low != 0 && v.low == low;
            let share = if h {
                (if low == 0 { 1. } else { 0.5 }) / nh as f64
            } else {
                0.
            } + if l { 0.5 / nl as f64 } else { 0. };
            let row = &mut self.stats[i];
            row[0] += weight * share;
            row[1] += weight * share * share;
            for (j, event) in [
                (share == 1.),
                (share > 0. && share < 1.),
                (share == 0.),
                (h && nh == 1),
                (h && nh > 1),
                (l && nl == 1),
                (l && nl > 1),
            ]
            .iter()
            .enumerate()
            {
                if *event {
                    row[j + 2] += weight;
                }
            }
        }
        self.mass += weight;
        self.outcomes += 1;
    }
    #[cfg(not(target_arch = "wasm32"))]
    fn merge(&mut self, other: Self) {
        self.outcomes += other.outcomes;
        self.attempts += other.attempts;
        self.mass += other.mass;
        for (a, b) in self.stats.iter_mut().zip(other.stats) {
            for (x, y) in a.iter_mut().zip(b) {
                *x += y;
            }
        }
    }
    fn finish(self, exact: bool) -> Result<ResultData, Error> {
        if self.mass <= 0. {
            return Err(Error::invalid("Ranges have no compatible legal deals"));
        }
        let players = self.stats[..self.players]
            .iter()
            .map(|r| {
                let equity = r[0] / self.mass;
                let stderr = if exact {
                    0.
                } else if self.outcomes < 2 {
                    f64::NAN
                } else {
                    ((r[1] / self.mass - equity * equity).max(0.) / (self.outcomes - 1) as f64)
                        .sqrt()
                };
                PlayerResult {
                    equity,
                    stderr,
                    win: r[2] / self.mass,
                    tie: r[3] / self.mass,
                    loss: r[4] / self.mass,
                    high_win: r[5] / self.mass,
                    high_tie: r[6] / self.mass,
                    low_win: r[7] / self.mass,
                    low_tie: r[8] / self.mass,
                }
            })
            .collect();
        Ok(ResultData {
            players,
            outcomes: self.outcomes,
            attempts: self.attempts,
        })
    }
}

fn context(
    ranges: &[Arc<CompiledRange>],
    board: &[u8],
    dead: &[u8],
    opt: &Options,
) -> Result<(Vec<Arc<CompiledRange>>, u64), Error> {
    if !(2..=10).contains(&ranges.len()) {
        return Err(Error::invalid("Use 2 to 10 players"));
    }
    if ![0, 3, 4, 5].contains(&board.len()) {
        return Err(Error::invalid("Board must have 0, 3, 4, or 5 cards"));
    }
    if !(1..=256).contains(&opt.threads) {
        return Err(Error::invalid("threads must be 1..256"));
    }
    if opt.max_exact == 0 || opt.samples == 0 {
        return Err(Error::invalid("samples and max_exact must be positive"));
    }
    let bm = cards_mask(board)?;
    let dm = cards_mask(dead)?;
    if bm & dm != 0 {
        return Err(Error::invalid("Duplicate board/dead card"));
    }
    let blocked = bm | dm;
    let missing = 5 - board.len();
    if blocked.count_ones() as usize + opt.game.hole_size() * ranges.len() + missing > 52 {
        return Err(Error::invalid("Not enough cards to complete the deal"));
    }
    let ranges = ranges
        .iter()
        .map(|r| {
            if r.game != opt.game {
                Err(Error::invalid(
                    "Compiled range game does not match simulation",
                ))
            } else {
                r.filtered(blocked)
            }
        })
        .collect::<Result<Vec<_>, _>>()?;
    initialize(opt.game);
    Ok((ranges, blocked))
}

pub fn simulate(
    ranges: &[Arc<CompiledRange>],
    board: &[u8],
    dead: &[u8],
    opt: &Options,
) -> Result<ResultData, Error> {
    let (ranges, blocked) = context(ranges, board, dead, opt)?;
    if opt.exact {
        return Exact::new(&ranges, board, opt).run(blocked);
    }
    let limit = if opt.max_attempts == 0 {
        opt.samples.saturating_mul(100).max(100000)
    } else {
        opt.max_attempts
    };
    if limit < opt.samples {
        return Err(Error::invalid(
            "max_attempts cannot be smaller than samples",
        ));
    }
    let workers = opt.threads.min(opt.samples.min(256) as usize);
    let work = |worker: usize| {
        let target = opt.samples / workers as u64
            + u64::from(worker < (opt.samples % workers as u64) as usize);
        let attempts =
            limit / workers as u64 + u64::from(worker < (limit % workers as u64) as usize);
        monte_carlo(&ranges, board, blocked, opt, target, attempts, worker)
    };
    #[cfg(target_arch = "wasm32")]
    {
        if workers != 1 {
            return Err(Error::invalid(
                "WebAssembly uses one worker per engine; threads must be 1",
            ));
        }
        work(0)?.finish(false)
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        let results = std::thread::scope(|scope| {
            let mut threads = Vec::new();
            for worker in 1..workers {
                threads.push(
                    std::thread::Builder::new()
                        .spawn_scoped(scope, move || work(worker))
                        .map_err(|_| Error::limit("Unable to start simulation thread"))?,
                );
            }
            let mut acc = work(0)?;
            for thread in threads {
                acc.merge(
                    thread
                        .join()
                        .map_err(|_| Error::limit("Simulation worker panicked"))??,
                );
            }
            Ok::<_, Error>(acc)
        })?;
        results.finish(false)
    }
}
/// Stateful independent Monte Carlo; batches preserve RNG state and cumulative statistics.
pub struct MonteCarloSession {
    ranges: Vec<Arc<CompiledRange>>,
    game: Game,
    board: [u8; 5],
    initial_len: usize,
    blocked: u64,
    fixed: Option<Prepared>,
    rng: Rng,
    acc: Acc,
    target: u64,
    limit: u64,
    free: [bool; 10],
    any_free: bool,
}
fn binomial(n: u32, k: u32) -> u64 {
    (0..k).fold(1u64, |r, i| r * (n - i) as u64 / (i + 1) as u64)
}
impl MonteCarloSession {
    pub fn new(
        ranges: &[Arc<CompiledRange>],
        board: &[u8],
        dead: &[u8],
        opt: &Options,
    ) -> Result<Self, Error> {
        if opt.exact || opt.threads != 1 {
            return Err(Error::invalid(
                "Progressive simulation requires Monte Carlo with one thread",
            ));
        }
        let (ranges, blocked) = context(ranges, board, dead, opt)?;
        let limit = if opt.max_attempts == 0 {
            opt.samples.saturating_mul(100).max(100000)
        } else {
            opt.max_attempts
        };
        if limit < opt.samples {
            return Err(Error::invalid(
                "max_attempts cannot be smaller than samples",
            ));
        }
        Ok(Self::from_context(
            ranges,
            board,
            blocked,
            opt.game,
            opt.samples,
            limit,
            opt.seed,
        ))
    }
    fn from_context(
        ranges: Vec<Arc<CompiledRange>>,
        initial: &[u8],
        blocked: u64,
        game: Game,
        target: u64,
        limit: u64,
        seed: u64,
    ) -> Self {
        let acc = Acc::new(ranges.len());
        let mut board = [0; 5];
        board[..initial.len()].copy_from_slice(initial);
        let fixed = if initial.len() == 5 {
            Some(Prepared::board(game, &board, tables()))
        } else {
            None
        };
        // A "free" player holds the full uniform universe of hands from the
        // unblocked cards (all C(n, k) subsets, equal weights).
        let k = game.hole_size() as u32;
        let universe = binomial(52 - blocked.count_ones(), k);
        let mut free = [false; 10];
        for (f, r) in free.iter_mut().zip(&ranges) {
            *f = r.alias.is_none() && r.combos.len() as u64 == universe;
        }
        let any_free = free.iter().any(|&f| f);
        Self {
            ranges,
            game,
            free,
            any_free,
            board,
            initial_len: initial.len(),
            blocked,
            fixed,
            rng: Rng::new(seed),
            acc,
            target,
            limit,
        }
    }
    pub fn done(&self) -> bool {
        self.acc.outcomes >= self.target
    }
    pub fn result(&self) -> Result<ResultData, Error> {
        self.acc.clone().finish(false)
    }
    pub fn step(&mut self, max_outcomes: u64) -> Result<bool, Error> {
        if max_outcomes == 0 {
            return Err(Error::invalid("Batch size must be positive"));
        }
        let end = self
            .acc
            .outcomes
            .saturating_add(max_outcomes)
            .min(self.target);
        // Bound work per call so low-acceptance deals still yield to the caller.
        let call_cap = max_outcomes.saturating_mul(64).max(1_000_000);
        let mut call_attempts = 0u64;
        let hole = self.game.hole_size();
        let t = tables();
        let omaha = omaha_for(self.game);
        let mut holes = [Prepared::hole(Game::Holdem, &[0, 1], t); 10];
        let mut values = [Value::default(); 10];
        while self.acc.outcomes < end && call_attempts < call_cap {
            call_attempts += 1;
            if self.acc.attempts >= self.limit {
                return Err(Error::limit("Monte Carlo attempt limit exceeded: ranges may be incompatible or heavily overlapping"));
            }
            self.acc.attempts += 1;
            let mut used = self.blocked;
            let mut legal = true;
            for (i, r) in self.ranges.iter().enumerate() {
                if self.free[i] {
                    continue;
                }
                let c = r.draw(&mut self.rng);
                if used & c.mask != 0 {
                    legal = false;
                    break;
                }
                used |= c.mask;
                holes[i] = c.prepared;
            }
            if !legal {
                continue;
            }
            // Exactness of the free-player shortcut: given the restricted players'
            // cards, the number of ways to deal disjoint free hands depends only on
            // how many cards are used (a constant), so the restricted players'
            // marginal is the same as under whole-deal rejection and free players
            // are uniform over the remaining cards. The target (independent ranges
            // conditioned on disjointness) is reproduced with no importance weights.
            if self.any_free {
                for (i, hole_slot) in holes.iter_mut().enumerate().take(self.ranges.len()) {
                    if !self.free[i] {
                        continue;
                    }
                    let mut cards = [0u8; 4];
                    for card in &mut cards[..hole] {
                        loop {
                            let c = self.rng.bounded(52) as u8;
                            if used & (1u64 << c) == 0 {
                                *card = c;
                                used |= 1u64 << c;
                                break;
                            }
                        }
                    }
                    *hole_slot = Prepared::hole(self.game, &cards[..hole], t);
                }
            }
            for card in &mut self.board[self.initial_len..] {
                loop {
                    let c = self.rng.bounded(52) as u8;
                    if used & (1u64 << c) == 0 {
                        *card = c;
                        used |= 1u64 << c;
                        break;
                    }
                }
            }
            let b = self
                .fixed
                .unwrap_or_else(|| Prepared::board(self.game, &self.board, t));
            for i in 0..self.ranges.len() {
                values[i] = prepared_value(self.game, holes[i], b, t, omaha);
            }
            self.acc.add(&values[..self.ranges.len()], 1.);
        }
        Ok(self.done())
    }
}
fn monte_carlo(
    ranges: &[Arc<CompiledRange>],
    initial: &[u8],
    blocked: u64,
    opt: &Options,
    target: u64,
    limit: u64,
    worker: usize,
) -> Result<Acc, Error> {
    let mut session = MonteCarloSession::from_context(
        ranges.to_vec(),
        initial,
        blocked,
        opt.game,
        target,
        limit,
        opt.seed.wrapping_add(worker as u64),
    );
    while !session.step(target)? {}
    Ok(session.acc)
}
struct Exact<'a> {
    ranges: &'a [Arc<CompiledRange>],
    opt: &'a Options,
    board: Vec<u8>,
    holes: [Prepared; 10],
    acc: Acc,
    visits: u64,
}
impl<'a> Exact<'a> {
    fn new(ranges: &'a [Arc<CompiledRange>], board: &[u8], opt: &'a Options) -> Self {
        Self {
            ranges,
            opt,
            board: board.to_vec(),
            holes: [Prepared::hole(Game::Holdem, &[0, 1], tables()); 10],
            acc: Acc::new(ranges.len()),
            visits: 0,
        }
    }
    fn run(mut self, used: u64) -> Result<ResultData, Error> {
        self.assign(0, used, 0.)?;
        self.acc.finish(true)
    }
    fn visit(&mut self) -> Result<(), Error> {
        self.visits += 1;
        if self.visits
            > self
                .opt
                .max_exact
                .saturating_mul(100)
                .saturating_add(1000000)
        {
            return Err(Error::limit(
                "Exact traversal limit exceeded; narrow ranges or use Monte Carlo",
            ));
        }
        Ok(())
    }
    fn assign(&mut self, player: usize, used: u64, log_weight: f64) -> Result<(), Error> {
        self.visit()?;
        if player < self.ranges.len() {
            for c in &self.ranges[player].combos {
                self.visit()?;
                if used & c.mask == 0 {
                    self.holes[player] = c.prepared;
                    self.assign(player + 1, used | c.mask, log_weight + c.weight.ln())?;
                }
            }
        } else {
            let available = mask_cards(((1u64 << 52) - 1) & !used);
            self.runouts(&available, 0, 5 - self.board.len(), log_weight)?;
        }
        Ok(())
    }
    fn runouts(
        &mut self,
        available: &[u8],
        start: usize,
        left: usize,
        log_weight: f64,
    ) -> Result<(), Error> {
        if left == 0 {
            if self.acc.outcomes >= self.opt.max_exact {
                return Err(Error::limit(
                    "Exact outcome limit exceeded; increase max_exact or use Monte Carlo",
                ));
            }
            let t = tables();
            let b = Prepared::board(self.opt.game, &self.board, t);
            let omaha = omaha_for(self.opt.game);
            let mut values = [Value::default(); 10];
            for (i, v) in values.iter_mut().enumerate().take(self.ranges.len()) {
                *v = prepared_value(self.opt.game, self.holes[i], b, t, omaha);
            }
            self.acc.add_log(&values[..self.ranges.len()], log_weight);
            return Ok(());
        }
        for i in start..=available.len() - left {
            self.board.push(available[i]);
            self.runouts(available, i + 1, left - 1, log_weight)?;
            self.board.pop();
        }
        Ok(())
    }
}

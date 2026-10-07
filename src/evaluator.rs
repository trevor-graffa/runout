use flate2::read::GzDecoder;
use std::{io::Read, sync::OnceLock};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Game {
    Holdem,
    Omaha,
    Omaha8,
}
impl Game {
    pub fn from_id(id: u8) -> Result<Self, Error> {
        match id {
            0 => Ok(Self::Holdem),
            1 => Ok(Self::Omaha),
            2 => Ok(Self::Omaha8),
            _ => Err(Error::invalid("Game ID must be 0, 1, or 2")),
        }
    }
    pub fn hole_size(self) -> usize {
        if self == Self::Holdem {
            2
        } else {
            4
        }
    }
}
#[derive(Debug, Clone)]
pub struct Error {
    pub message: &'static str,
    pub limit: bool,
}
impl Error {
    pub fn invalid(message: &'static str) -> Self {
        Self {
            message,
            limit: false,
        }
    }
    pub fn limit(message: &'static str) -> Self {
        Self {
            message,
            limit: true,
        }
    }
}
impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.message)
    }
}
impl std::error::Error for Error {}
#[derive(Clone, Copy, Default, Debug, PartialEq, Eq)]
pub struct Value {
    pub high: u32,
    pub low: u32,
}

pub fn cards_mask(cards: &[u8]) -> Result<u64, Error> {
    let mut mask = 0;
    for &c in cards {
        if c >= 52 || mask & (1u64 << c) != 0 {
            return Err(Error::invalid("Invalid or duplicate card ID"));
        }
        mask |= 1u64 << c;
    }
    Ok(mask)
}
pub fn mask_cards(mut mask: u64) -> Vec<u8> {
    let mut cards = Vec::with_capacity(mask.count_ones() as usize);
    while mask != 0 {
        cards.push(mask.trailing_zeros() as u8);
        mask &= mask - 1;
    }
    cards
}

pub(crate) struct Tables {
    ranks: Vec<u32>,
    offsets: Vec<u32>,
    lookup: Vec<u16>,
    flush: Vec<u16>,
    translation: Vec<u32>,
    rank4: Vec<u16>,
    rank5: Vec<u16>,
    low: Vec<u32>,
    cards: [Hand; 52],
}
fn inflate(bytes: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    GzDecoder::new(bytes)
        .read_to_end(&mut out)
        .expect("bundled numeric tables are valid gzip");
    out
}
pub(crate) fn tables() -> &'static Tables {
    static TABLES: OnceLock<Tables> = OnceLock::new();
    TABLES.get_or_init(|| {
        let bytes = inflate(include_bytes!("../data/core.bin.gz"));
        assert_eq!(&bytes[..4], b"PKE1");
        let mut cursor = 4;
        fn u32s(bytes: &[u8], cursor: &mut usize, n: usize) -> Vec<u32> {
            let out = bytes[*cursor..*cursor + n * 4]
                .as_chunks::<4>()
                .0
                .iter()
                .map(|b| u32::from_le_bytes(*b))
                .collect();
            *cursor += n * 4;
            out
        }
        fn u16s(bytes: &[u8], cursor: &mut usize, n: usize) -> Vec<u16> {
            let out = bytes[*cursor..*cursor + n * 2]
                .as_chunks::<2>()
                .0
                .iter()
                .map(|b| u16::from_le_bytes(*b))
                .collect();
            *cursor += n * 2;
            out
        }
        let mut t = Tables {
            ranks: u32s(&bytes, &mut cursor, 13),
            offsets: u32s(&bytes, &mut cursor, 8191),
            lookup: u16s(&bytes, &mut cursor, 86547),
            flush: u16s(&bytes, &mut cursor, 8192),
            translation: u32s(&bytes, &mut cursor, 65536),
            rank4: u16s(&bytes, &mut cursor, 65536),
            rank5: u16s(&bytes, &mut cursor, 65536),
            low: u32s(&bytes, &mut cursor, 65536),
            cards: [Hand::default(); 52],
        };
        // Cache the numeric contribution of each card, as OMPEval does. Hot
        // aggregation uses additions/bitwise OR rather than shifts and branches.
        t.cards = std::array::from_fn(|card| {
            let rank = card / 4;
            let suit = card % 4;
            let mut suits = [0; 4];
            suits[suit] = 1 << rank;
            Hand {
                key: t.ranks[rank],
                counters: 1 << (4 * suit),
                suits,
                low: if rank == 12 {
                    1
                } else if rank <= 6 {
                    1 << (rank + 1)
                } else {
                    0
                },
            }
        });
        assert_eq!(cursor, bytes.len());
        t
    })
}
static OMAHA: OnceLock<Vec<u16>> = OnceLock::new();
pub fn initialize_omaha_bytes(bytes: &[u8]) -> Result<(), Error> {
    if bytes.len() != 6175 * 1820 * 2 {
        return Err(Error::invalid("Invalid Omaha lookup byte count"));
    }
    let values = bytes
        .as_chunks::<2>()
        .0
        .iter()
        .map(|b| u16::from_le_bytes(*b))
        .collect();
    let _ = OMAHA.set(values);
    Ok(())
}
fn omaha_table() -> &'static [u16] {
    OMAHA.get_or_init(|| {
        let bytes = inflate(include_bytes!("../poker_engine/data/omaha.bin.gz"));
        assert_eq!(bytes.len(), 6175 * 1820 * 2);
        bytes
            .as_chunks::<2>()
            .0
            .iter()
            .map(|b| u16::from_le_bytes(*b))
            .collect()
    })
}
pub fn initialize(game: Game) {
    tables();
    if game != Game::Holdem {
        omaha_table();
    }
}

#[derive(Clone, Copy, Default)]
pub(crate) struct Hand {
    key: u32,
    counters: u16,
    pub suits: [u16; 4],
    pub low: u8,
}
impl Hand {
    #[inline]
    pub fn add(&mut self, card: u8, t: &Tables) {
        *self = self.combine(t.cards[card as usize]);
    }
    #[inline]
    pub fn new(cards: &[u8], t: &Tables) -> Self {
        let mut h = Self::default();
        for &c in cards {
            h.add(c, t);
        }
        h
    }
    #[inline]
    fn nonflush(self, t: &Tables) -> u16 {
        let index = self.key.wrapping_add(t.offsets[(self.key >> 12) as usize]);
        t.lookup[index as usize]
    }
    #[inline]
    pub fn combine(self, other: Self) -> Self {
        Self {
            key: self.key + other.key,
            counters: self.counters + other.counters,
            suits: std::array::from_fn(|s| self.suits[s] | other.suits[s]),
            low: self.low | other.low,
        }
    }
    #[inline]
    fn high(self, t: &Tables) -> u32 {
        let flush = (self.counters + 0x3333) & 0x8888;
        let value = if flush == 0 {
            self.nonflush(t)
        } else {
            t.flush[self.suits[(flush.trailing_zeros() / 4) as usize] as usize]
        };
        t.translation[value as usize]
    }
}
#[derive(Clone, Copy)]
pub(crate) struct Prepared {
    pub hand: Hand,
    pub rank: usize,
}
impl Prepared {
    pub fn hole(game: Game, cards: &[u8], t: &Tables) -> Self {
        let hand = Hand::new(cards, t);
        Self {
            hand,
            rank: if game == Game::Holdem {
                0
            } else {
                t.rank4[hand.nonflush(t) as usize] as usize
            },
        }
    }
    pub fn board(game: Game, cards: &[u8], t: &Tables) -> Self {
        let hand = Hand::new(cards, t);
        Self {
            hand,
            rank: if game == Game::Holdem {
                0
            } else {
                t.rank5[hand.nonflush(t) as usize] as usize * 1820
            },
        }
    }
}
#[inline]
pub(crate) fn prepared_value(
    game: Game,
    hole: Prepared,
    board: Prepared,
    t: &Tables,
    omaha: &[u16],
) -> Value {
    if game == Game::Holdem {
        return Value {
            high: hole.hand.combine(board.hand).high(t),
            low: 0,
        };
    }
    let mut high = t.translation[omaha[board.rank + hole.rank] as usize];
    for suit in 0..4 {
        let hm = hole.hand.suits[suit];
        let bm = board.hand.suits[suit];
        if hm.count_ones() < 2 || bm.count_ones() < 3 {
            continue;
        }
        // Only enumerate the rare suited selections, not all 60 rank selections.
        let mut h = [0u16; 4];
        let mut b = [0u16; 5];
        let (mut nh, mut nb) = (0, 0);
        for r in 0..13 {
            if hm & (1 << r) != 0 {
                h[nh] = 1 << r;
                nh += 1;
            }
            if bm & (1 << r) != 0 {
                b[nb] = 1 << r;
                nb += 1;
            }
        }
        for a in 0..nh - 1 {
            for c in a + 1..nh {
                for x in 0..nb - 2 {
                    for y in x + 1..nb - 1 {
                        for z in y + 1..nb {
                            let mask = h[a] | h[c] | b[x] | b[y] | b[z];
                            high = high.max(t.translation[t.flush[mask as usize] as usize]);
                        }
                    }
                }
            }
        }
        break;
    }
    Value {
        high,
        low: if game == Game::Omaha8 {
            t.low[hole.hand.low as usize * 256 + board.hand.low as usize]
        } else {
            0
        },
    }
}
pub(crate) fn omaha_for(game: Game) -> &'static [u16] {
    if game == Game::Holdem {
        &[]
    } else {
        omaha_table()
    }
}
pub fn evaluate_high(cards: &[u8]) -> Result<u32, Error> {
    if !(5..=7).contains(&cards.len()) {
        return Err(Error::invalid("High evaluation requires 5 to 7 cards"));
    }
    let t = tables();
    let mut hand = Hand::default();
    let mut used = 0u64;
    for &card in cards {
        if card >= 52 || used & (1u64 << card) != 0 {
            return Err(Error::invalid("Invalid or duplicate card ID"));
        }
        used |= 1u64 << card;
        hand.add(card, t);
    }
    Ok(hand.high(t))
}
pub fn evaluate(game: Game, hole: &[u8], board: &[u8]) -> Result<Value, Error> {
    if hole.len() != game.hole_size() {
        return Err(Error::invalid("Hole-card count does not match game"));
    }
    if !(3..=5).contains(&board.len()) {
        return Err(Error::invalid("Board requires 3 to 5 cards for evaluation"));
    }
    if cards_mask(hole)? & cards_mask(board)? != 0 {
        return Err(Error::invalid("Hole cards overlap board"));
    }
    let t = tables();
    if game == Game::Holdem {
        return Ok(Value {
            high: Hand::new(hole, t).combine(Hand::new(board, t)).high(t),
            low: 0,
        });
    }
    if board.len() == 5 {
        return Ok(prepared_value(
            game,
            Prepared::hole(game, hole, t),
            Prepared::board(game, board, t),
            t,
            omaha_table(),
        ));
    }
    let mut best = Value::default();
    for a in 0..3 {
        for b in a + 1..4 {
            let pair = Hand::new(&[hole[a], hole[b]], t);
            for x in 0..board.len() - 2 {
                for y in x + 1..board.len() - 1 {
                    for z in y + 1..board.len() {
                        let triple = Hand::new(&[board[x], board[y], board[z]], t);
                        best.high = best.high.max(pair.combine(triple).high(t));
                        if game == Game::Omaha8 {
                            let low = t.low[pair.low as usize * 256 + triple.low as usize];
                            if low != 0 && (best.low == 0 || low < best.low) {
                                best.low = low;
                            }
                        }
                    }
                }
            }
        }
    }
    Ok(best)
}

#include "fast_eval.hpp"
#include <algorithm>
#include <functional>
#include <mutex>
#include <stdexcept>

namespace poker {
omp::HandEvaluator& fast_evaluator() {
    static omp::HandEvaluator evaluator;
    return evaluator;
}
namespace {
using Counts = std::array<unsigned char, 13>;
std::vector<Counts> patterns(unsigned n) {
    std::vector<Counts> result; Counts q{};
    std::function<void(unsigned, unsigned)> visit = [&](unsigned rank, unsigned left) {
        if (rank == 13) { if (!left) result.push_back(q); return; }
        for (unsigned count = 0; count <= std::min(4u, left); ++count) {
            q[rank] = static_cast<unsigned char>(count); visit(rank + 1, left - count);
        }
    };
    visit(0, n); return result;
}
std::vector<Card> physical(const Counts& q) {
    std::vector<Card> cards; unsigned index = 0;
    for (unsigned r = 0; r < 13; ++r) for (unsigned j = 0; j < q[r]; ++j)
        cards.push_back(Card(r * 4 + (index++ % 4)));
    return cards;
}
struct ScoreTables {
    std::array<uint32_t, 65536> translation{};
    std::array<uint32_t, 8192> flush{};
    std::array<uint32_t, 65536> low{};
    std::array<uint16_t, 65536> rank4{};
    std::array<uint16_t, 65536> rank5{};
    ScoreTables() {
        auto& eval = fast_evaluator();
        // Ignoring flushes, every 4- or 5-card rank multiset has a distinct
        // OMPEval score at that cardinality. This replaces a 13-digit hash loop
        // with a compact two-level additive hash and one remapping lookup.
        unsigned index = 0;
        std::array<bool, 65536> seen{};
        for (const auto& q : patterns(4)) {
            auto c = physical(q); auto hand = omp::Hand::empty();
            for (auto card : c) hand += omp::Hand(card);
            auto v = eval.evaluate<false>(hand);
            if (seen[v]) throw std::runtime_error("Four-card rank hash collision");
            seen[v] = true; rank4[v] = uint16_t(index++);
        }
        index = 0; seen.fill(false);
        for (const auto& q : patterns(5)) {
            auto c = physical(q); auto hand = omp::Hand::empty();
            for (auto card : c) hand += omp::Hand(card);
            auto v = eval.evaluate<false>(hand);
            if (seen[v]) throw std::runtime_error("Five-card rank hash collision");
            seen[v] = true; rank5[v] = uint16_t(index++);
            translation[v] = evaluate_high_reference(c.data(), 5);
        }
        for (unsigned m = 0; m < 8192; ++m) {
            if (card_count(m) != 5) continue;
            Card c[5]; unsigned n = 0; auto hand = omp::Hand::empty();
            for (unsigned r = 0; r < 13; ++r) if (m & (1u << r)) { c[n++] = Card(r * 4); hand += omp::Hand(r * 4); }
            flush[m] = evaluate_high_reference(c, 5);
            translation[eval.evaluate(hand)] = flush[m];
        }
        std::vector<std::pair<uint32_t, unsigned>> candidates;
        for (unsigned m = 0; m < 256; ++m) if (omp::bitCount(m) == 5) {
            uint32_t v = 0;
            for (int r = 7; r >= 0; --r) if (m & (1u << r)) v = (v << 4) | unsigned(r + 1);
            candidates.emplace_back(v, m);
        }
        std::sort(candidates.begin(), candidates.end());
        for (unsigned h = 0; h < 256; ++h) for (unsigned b = 0; b < 256; ++b) {
            if (omp::bitCount(h) < 2 || omp::bitCount(b) < 3) continue;
            for (auto [v, m] : candidates) {
                if (((h | b) & m) == m && omp::bitCount(h & m) >= 2 && omp::bitCount(b & m) >= 3 &&
                    omp::bitCount(m & ~b) <= 2 && omp::bitCount(m & ~h) <= 3) {
                    low[h * 256 + b] = v; break;
                }
            }
        }
    }
};
const ScoreTables& scores() { static ScoreTables t; return t; }
unsigned low_bit(Card card) {
    unsigned r = card / 4;
    return r == 12 ? 1u : r <= 6 ? 1u << (r + 1) : 0;
}
std::vector<uint16_t> omaha_table;
std::once_flag omaha_once;
}
uint32_t translate_high(uint16_t score) { return scores().translation[score]; }
std::vector<uint16_t> generate_omaha_table() {
    auto triples = patterns(3), pairs = patterns(2), boards = patterns(5), holes = patterns(4);
    std::vector<uint16_t> pair_triple(triples.size() * pairs.size());
    auto& eval = fast_evaluator();
    for (size_t t = 0; t < triples.size(); ++t) for (size_t p = 0; p < pairs.size(); ++p) {
        Counts q{}; bool valid = true;
        for (unsigned r = 0; r < 13; ++r) { q[r] = triples[t][r] + pairs[p][r]; if (q[r] > 4) valid = false; }
        if (!valid) continue;
        auto c = physical(q); auto h = omp::Hand::empty();
        for (auto card : c) h += omp::Hand(card);
        pair_triple[t * pairs.size() + p] = eval.evaluate<false>(h);
    }
    std::vector<std::vector<unsigned>> bt(boards.size()), hp(holes.size());
    auto subpatterns = [](const auto& full, const auto& parts, auto& out) {
        for (size_t f = 0; f < full.size(); ++f) for (size_t p = 0; p < parts.size(); ++p) {
            bool fits = true;
            for (unsigned r = 0; r < 13; ++r) if (parts[p][r] > full[f][r]) { fits = false; break; }
            if (fits) out[f].push_back(unsigned(p));
        }
    };
    subpatterns(boards, triples, bt); subpatterns(holes, pairs, hp);
    std::vector<uint16_t> table(OMAHA_TABLE_SIZE);
    // A board's best score for each possible pair is reusable across all hole patterns.
    for (size_t b = 0; b < boards.size(); ++b) {
        std::vector<uint16_t> best_pair(pairs.size());
        for (auto t : bt[b]) for (size_t p = 0; p < pairs.size(); ++p)
            best_pair[p] = std::max(best_pair[p], pair_triple[t * pairs.size() + p]);
        for (size_t h = 0; h < holes.size(); ++h) {
            uint16_t best = 0;
            for (auto p : hp[h]) best = std::max(best, best_pair[p]);
            table[b * holes.size() + h] = best;
        }
    }
    return table;
}
void initialize_omaha_table(const uint16_t* values, size_t count) {
    if (values && count != OMAHA_TABLE_SIZE) throw std::invalid_argument("Invalid Omaha numeric lookup table size");
    std::call_once(omaha_once, [&] {
        omaha_table = values ? std::vector<uint16_t>(values, values + count) : generate_omaha_table();
    });
}
FastHole prepare_hole(Game game, const Card* c) {
    fast_evaluator(); FastHole hole; hole.high = omp::Hand(c[0]) + omp::Hand(c[1]);
    if (game == Game::Holdem) return hole;
    hole.high += omp::Hand(c[2]); hole.high += omp::Hand(c[3]);
    for (unsigned i = 0; i < 4; ++i) hole.suits[c[i] % 4] |= 1u << (c[i] / 4);
    // Include empty() exactly once for OMPEval's cardinality invariant.
    hole.rank_hash = scores().rank4[fast_evaluator().evaluate<false>(hole.high + omp::Hand::empty())];
    if (game == Game::Omaha8) {
        for (unsigned i = 0; i < 4; ++i) hole.low_mask |= low_bit(c[i]);
    }
    return hole;
}
FastBoard prepare_board(Game game, const Card* c) {
    FastBoard board; board.high = omp::Hand::empty();
    if (game == Game::Holdem) {
        for (unsigned i = 0; i < 5; ++i) board.high += omp::Hand(c[i]);
        return board;
    }
    for (unsigned i = 0; i < 5; ++i) {
        board.high += omp::Hand(c[i]); board.suits[c[i] % 4] |= 1u << (c[i] / 4);
    }
    board.rank_hash = scores().rank5[fast_evaluator().evaluate<false>(board.high)];
    if (game == Game::Omaha8) {
        for (unsigned i = 0; i < 5; ++i) board.low_mask |= low_bit(c[i]);
    }
    return board;
}
Value evaluate_prepared(Game game, const FastHole& hole, const FastBoard& board) {
    auto& table = scores();
    if (game == Game::Holdem) return {table.translation[fast_evaluator().evaluate(hole.high + board.high)], 0};
    Value value{table.translation[omaha_table[board.rank_hash * 1820 + hole.rank_hash]], 0};
    // Flushes remain separate: only one board suit can have three cards.
    for (unsigned s = 0; s < 4; ++s) {
        unsigned bm = board.suits[s], hm = hole.suits[s];
        if (omp::bitCount(bm) < 3 || omp::bitCount(hm) < 2) continue;
        unsigned br[5], hr[4], nb = 0, nh = 0;
        for (unsigned r = 0; r < 13; ++r) {
            if (bm & (1u << r)) br[nb++] = 1u << r;
            if (hm & (1u << r)) hr[nh++] = 1u << r;
        }
        for (unsigned a = 0; a + 1 < nh; ++a) for (unsigned b = a + 1; b < nh; ++b)
            for (unsigned x = 0; x + 2 < nb; ++x) for (unsigned y = x + 1; y + 1 < nb; ++y)
                for (unsigned z = y + 1; z < nb; ++z)
                    value.high = std::max(value.high, table.flush[hr[a] | hr[b] | br[x] | br[y] | br[z]]);
        break;
    }
    if (game == Game::Omaha8) {
        value.low = table.low[hole.low_mask * 256 + board.low_mask];
    }
    return value;
}
} // namespace poker

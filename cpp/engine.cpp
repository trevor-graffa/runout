#include "engine.hpp"
#include "fast_eval.hpp"
#include <algorithm>
#include <cmath>
#include <exception>
#include <functional>
#include <limits>
#include <numeric>
#include <random>
#include <stdexcept>
#include <thread>
#include <unordered_set>

namespace poker {
unsigned card_count(Mask m) {
    return omp::bitCount(static_cast<unsigned long long>(m));
}
std::vector<Card> cards_from_mask(Mask m) {
    std::vector<Card> out;
    for (unsigned c = 0; c < 52; ++c) if (m & (Mask(1) << c)) out.push_back(Card(c));
    return out;
}
namespace {
uint32_t pack(unsigned category, const int* ranks, unsigned n) {
    uint32_t v = category << 20;
    for (unsigned i = 0; i < n; ++i) v |= uint32_t(ranks[i] + 2) << (16 - 4 * i);
    return v;
}
struct MaskTables {
    std::array<int, 8192> straight{};
    std::array<uint32_t, 8192> top{};
    MaskTables() {
        for (unsigned m = 0; m < 8192; ++m) {
            straight[m] = -1;
            for (int hi = 12; hi >= 4; --hi) {
                unsigned pattern = 31u << (hi - 4);
                if ((m & pattern) == pattern) { straight[m] = hi; break; }
            }
            if (straight[m] < 0 && (m & 0x100f) == 0x100f) straight[m] = 3;
            int ranks[5]; unsigned n = 0;
            for (int r = 12; r >= 0 && n < 5; --r) if (m & (1u << r)) ranks[n++] = r;
            top[m] = pack(0, ranks, n);
        }
    }
};
const MaskTables tables;
}
uint32_t evaluate_high_reference(const Card* cards, unsigned n) {
    if (n < 5 || n > 7) throw std::invalid_argument("High evaluation requires 5 to 7 cards");
    unsigned counts[13] = {}, suits[4] = {}, suit_masks[4] = {}, mask = 0;
    for (unsigned i = 0; i < n; ++i) {
        unsigned r = cards[i] / 4, s = cards[i] % 4;
        if (cards[i] >= 52) throw std::invalid_argument("Card ID outside 0..51");
        ++counts[r]; ++suits[s]; suit_masks[s] |= 1u << r; mask |= 1u << r;
    }
    int flush = -1;
    for (int s = 0; s < 4; ++s) if (suits[s] >= 5) {
        if (tables.straight[suit_masks[s]] >= 0) {
            int r = tables.straight[suit_masks[s]];
            return pack(8, &r, 1);
        }
        flush = s;
    }
    int quad = -1, trip = -1, pair = -1;
    for (int r = 12; r >= 0; --r) {
        if (counts[r] == 4) quad = r;
        if (counts[r] >= 3 && trip < 0) trip = r;
    }
    int ranks[5];
    if (quad >= 0) {
        ranks[0] = quad;
        for (int r = 12; r >= 0; --r) if (r != quad && counts[r]) { ranks[1] = r; break; }
        return pack(7, ranks, 2);
    }
    if (trip >= 0) {
        for (int r = 12; r >= 0; --r) if (r != trip && counts[r] >= 2) { pair = r; break; }
        if (pair >= 0) { ranks[0] = trip; ranks[1] = pair; return pack(6, ranks, 2); }
    }
    if (flush >= 0) return (5u << 20) | tables.top[suit_masks[flush]];
    if (tables.straight[mask] >= 0) { int r = tables.straight[mask]; return pack(4, &r, 1); }
    if (trip >= 0) {
        ranks[0] = trip; unsigned k = 1;
        for (int r = 12; r >= 0 && k < 3; --r) if (r != trip && counts[r]) ranks[k++] = r;
        return pack(3, ranks, 3);
    }
    unsigned pairs = 0;
    for (int r = 12; r >= 0 && pairs < 2; --r) if (counts[r] >= 2) ranks[pairs++] = r;
    if (pairs == 2) {
        for (int r = 12; r >= 0; --r) if (r != ranks[0] && r != ranks[1] && counts[r]) {
            ranks[2] = r; break;
        }
        return pack(2, ranks, 3);
    }
    if (pairs == 1) {
        unsigned k = 1;
        for (int r = 12; r >= 0 && k < 4; --r) if (r != ranks[0] && counts[r]) ranks[k++] = r;
        return pack(1, ranks, 4);
    }
    return tables.top[mask];
}
uint32_t evaluate_high(const Card* cards, unsigned n) {
    if (n < 5 || n > 7) throw std::invalid_argument("High evaluation requires 5 to 7 cards");
    fast_evaluator(); auto hand = omp::Hand::empty(); Mask used = 0;
    for (unsigned i = 0; i < n; ++i) {
        if (cards[i] >= 52 || (used & (Mask(1) << cards[i])))
            throw std::invalid_argument("Invalid or duplicate card ID");
        used |= Mask(1) << cards[i]; hand += omp::Hand(cards[i]);
    }
    return translate_high(fast_evaluator().evaluate(hand));
}
uint32_t evaluate_low(const Card* cards) {
    unsigned mask = 0;
    for (unsigned i = 0; i < 5; ++i) {
        unsigned r = cards[i] / 4;
        unsigned low = r == 12 ? 1 : r + 2;
        if (low > 8 || (mask & (1u << low))) return 0;
        mask |= 1u << low;
    }
    uint32_t value = 0;
    for (int r = 8; r >= 1; --r) if (mask & (1u << r)) value = (value << 4) | unsigned(r);
    return value;
}
Value evaluate(Game game, const std::vector<Card>& hole, const std::vector<Card>& board) {
    Mask used = 0;
    auto validate = [&](Card c) {
        if (c >= 52 || (used & (Mask(1) << c))) throw std::invalid_argument("Invalid or duplicate evaluation card");
        used |= Mask(1) << c;
    };
    for (auto c : hole) validate(c);
    for (auto c : board) validate(c);
    if (board.size() < 3 || board.size() > 5) throw std::invalid_argument("Board requires 3 to 5 cards for evaluation");
    if (game == Game::Holdem) {
        if (hole.size() != 2) throw std::invalid_argument("Hold'em requires two hole cards");
        Card all[7]; std::copy(hole.begin(), hole.end(), all);
        std::copy(board.begin(), board.end(), all + 2);
        return {evaluate_high(all, unsigned(board.size() + 2)), 0};
    }
    if (hole.size() != 4) throw std::invalid_argument("Omaha requires four hole cards");
    if (board.size() == 5) {
        initialize_omaha_table();
        return evaluate_prepared(game, prepare_hole(game, hole.data()), prepare_board(game, board.data()));
    }
    Value best{0, 0}; Card five[5];
    for (unsigned a = 0; a < 3; ++a) for (unsigned b = a + 1; b < 4; ++b) {
        five[0] = hole[a]; five[1] = hole[b];
        for (unsigned x = 0; x + 2 < board.size(); ++x)
            for (unsigned y = x + 1; y + 1 < board.size(); ++y)
                for (unsigned z = y + 1; z < board.size(); ++z) {
                    five[2] = board[x]; five[3] = board[y]; five[4] = board[z];
                    best.high = std::max(best.high, evaluate_high(five, 5));
                    if (game == Game::Omaha8) {
                        auto low = evaluate_low(five);
                        if (low && (!best.low || low < best.low)) best.low = low;
                    }
                }
    }
    return best;
}
long double outcome_bound(const std::vector<Range>& ranges, unsigned board_size,
                          unsigned dead_size, unsigned hole_size) {
    int available = 52 - int(board_size + dead_size + ranges.size() * hole_size);
    unsigned missing = 5 - board_size;
    if (available < int(missing)) return 0;
    long double bound = 1;
    for (unsigned i = 0; i < missing; ++i) bound *= (available - i) / static_cast<long double>(i + 1);
    for (const auto& r : ranges) bound *= r.size();
    return bound;
}
namespace {
struct Accumulator {
    std::vector<PlayerResult> players;
    std::vector<long double> sum, square;
    uint64_t outcomes = 0, attempts = 0;
    long double mass = 0;
    explicit Accumulator(size_t n) : players(n), sum(n), square(n) {}
    void add(const std::vector<Value>& values, long double weight) {
        uint32_t high = 0, low = 0;
        for (auto v : values) {
            high = std::max(high, v.high);
            if (v.low && (!low || v.low < low)) low = v.low;
        }
        unsigned nh = 0, nl = 0;
        for (auto v : values) { nh += v.high == high; nl += low && v.low == low; }
        for (size_t i = 0; i < values.size(); ++i) {
            bool h = values[i].high == high, l = low && values[i].low == low;
            double share = (h ? (low ? 0.5 : 1.0) / nh : 0) + (l ? 0.5 / nl : 0);
            auto& p = players[i];
            sum[i] += weight * share; square[i] += weight * share * share;
            p.win += double(weight) * (share == 1);
            p.tie += double(weight) * (share > 0 && share < 1);
            p.loss += double(weight) * (share == 0);
            p.high_win += double(weight) * (h && nh == 1);
            p.high_tie += double(weight) * (h && nh > 1);
            p.low_win += double(weight) * (l && nl == 1);
            p.low_tie += double(weight) * (l && nl > 1);
        }
        mass += weight; ++outcomes;
    }
    void merge(const Accumulator& other) {
        outcomes += other.outcomes; attempts += other.attempts; mass += other.mass;
        for (size_t i = 0; i < players.size(); ++i) {
            sum[i] += other.sum[i]; square[i] += other.square[i];
            auto& a = players[i]; const auto& b = other.players[i];
            a.win += b.win; a.tie += b.tie; a.loss += b.loss;
            a.high_win += b.high_win; a.high_tie += b.high_tie;
            a.low_win += b.low_win; a.low_tie += b.low_tie;
        }
    }
    Result finish(bool exact) {
        if (!outcomes || mass <= 0) throw std::invalid_argument("Ranges have no compatible legal deals");
        for (size_t i = 0; i < players.size(); ++i) {
            auto& p = players[i]; p.equity = double(sum[i] / mass);
            p.stderr = exact ? 0 : (outcomes > 1 ? std::sqrt(double(std::max(0.L,
                square[i] / mass - (sum[i] / mass) * (sum[i] / mass)) / (outcomes - 1))) :
                std::numeric_limits<double>::quiet_NaN());
            p.win /= double(mass); p.tie /= double(mass); p.loss /= double(mass);
            p.high_win /= double(mass); p.high_tie /= double(mass);
            p.low_win /= double(mass); p.low_tie /= double(mass);
        }
        return {players, outcomes, attempts, double(mass)};
    }
};
struct PreparedCombo { Mask mask; FastHole hole; double weight; };
using PreparedRange = std::vector<PreparedCombo>;
struct Alias {
    std::vector<double> probability;
    std::vector<size_t> alias;
    bool uniform = true;
    explicit Alias(const PreparedRange& range) {
        for (const auto& c : range) uniform &= c.weight == range[0].weight;
        if (uniform) return;
        probability.resize(range.size()); alias.resize(range.size());
        long double total = 0;
        for (const auto& c : range) total += c.weight;
        std::vector<double> scaled; std::vector<size_t> small, large;
        for (size_t i = 0; i < range.size(); ++i) {
            scaled.push_back(double(range[i].weight * range.size() / total));
            (scaled.back() < 1 ? small : large).push_back(i);
        }
        while (!small.empty() && !large.empty()) {
            size_t s = small.back(); small.pop_back(); size_t l = large.back(); large.pop_back();
            probability[s] = scaled[s]; alias[s] = l;
            scaled[l] += scaled[s] - 1;
            (scaled[l] < 1 ? small : large).push_back(l);
        }
        for (auto i : small) { probability[i] = 1; alias[i] = i; }
        for (auto i : large) { probability[i] = 1; alias[i] = i; }
    }
    size_t draw(std::mt19937_64& rng) const {
        size_t col = std::uniform_int_distribution<size_t>(0, probability.size() - 1)(rng);
        return std::generate_canonical<double, 53>(rng) < probability[col] ? col : alias[col];
    }
};
uint64_t mix(uint64_t x) {
    x += 0x9e3779b97f4a7c15ULL; x = (x ^ (x >> 30)) * 0xbf58476d1ce4e5b9ULL;
    x = (x ^ (x >> 27)) * 0x94d049bb133111ebULL; return x ^ (x >> 31);
}
}
struct CompiledRange {
    PreparedRange combos;
    Alias alias;
    Game game;
    Mask union_mask = 0;
    CompiledRange(PreparedRange p, Game g) : combos(std::move(p)), alias(combos), game(g) {
        for (const auto& c : combos) union_mask |= c.mask;
    }
    size_t draw(std::mt19937_64& rng) const {
        return alias.uniform ? std::uniform_int_distribution<size_t>(0, combos.size() - 1)(rng) : alias.draw(rng);
    }
};
CompiledRangePtr compile_range(const Range& range, Game game, Mask blocked) {
    unsigned hole_size = game == Game::Holdem ? 2 : 4;
    PreparedRange p; p.reserve(range.size()); double max_weight = 0;
    std::unordered_set<Mask> seen; seen.reserve(range.size());
    for (auto c : range) {
        if ((c.mask >> 52) || card_count(c.mask) != hole_size)
            throw std::invalid_argument("Range combo has invalid card mask or hole-card count");
        if (!std::isfinite(c.weight) || c.weight <= 0)
            throw std::invalid_argument("Combo weights must be finite and positive");
        if (!seen.insert(c.mask).second) throw std::invalid_argument("Duplicate range combo");
        if (!(c.mask & blocked)) {
            auto cards = cards_from_mask(c.mask);
            p.push_back({c.mask, prepare_hole(game, cards.data()), c.weight});
            max_weight = std::max(max_weight, c.weight);
        }
    }
    if (p.empty()) throw std::invalid_argument("A player range is empty after card removal");
    for (auto& c : p) {
        c.weight /= max_weight;
        if (c.weight == 0) throw std::invalid_argument("Weight dynamic range exceeds floating-point precision");
    }
    return std::make_shared<CompiledRange>(std::move(p), game);
}
Result simulate(std::vector<Range> ranges, const std::vector<Card>& initial_board,
                const std::vector<Card>& dead, const Options& opt) {
    Mask blocked = 0;
    for (auto c : initial_board) { if (c >= 52) throw std::invalid_argument("Invalid board card"); blocked |= Mask(1) << c; }
    for (auto c : dead) { if (c >= 52) throw std::invalid_argument("Invalid dead card"); blocked |= Mask(1) << c; }
    std::vector<CompiledRangePtr> compiled;
    for (const auto& r : ranges) compiled.push_back(compile_range(r, opt.game, blocked));
    return simulate(std::move(compiled), initial_board, dead, opt);
}
Result simulate(std::vector<CompiledRangePtr> ranges, const std::vector<Card>& initial_board,
                const std::vector<Card>& dead, const Options& opt) {
    const unsigned hole_size = opt.game == Game::Holdem ? 2 : 4;
    if (ranges.size() < 2 || ranges.size() > 10) throw std::invalid_argument("Use 2 to 10 players");
    if (initial_board.size() > 5 || initial_board.size() == 1 || initial_board.size() == 2)
        throw std::invalid_argument("Board must have 0, 3, 4, or 5 cards");
    if (!opt.threads || opt.threads > 256) throw std::invalid_argument("threads must be 1..256");
    if (!opt.max_exact) throw std::invalid_argument("max_exact must be positive");
    if (!opt.exact && !opt.samples) throw std::invalid_argument("samples must be positive");
    Mask blocked = 0;
    auto block = [&](Card c) {
        if (c >= 52 || (blocked & (Mask(1) << c))) throw std::invalid_argument("Invalid or duplicate board/dead card");
        blocked |= Mask(1) << c;
    };
    for (auto c : initial_board) block(c);
    for (auto c : dead) block(c);
    if (card_count(blocked) + hole_size * ranges.size() + 5 - initial_board.size() > 52)
        throw std::invalid_argument("Not enough cards to complete the deal");
    for (auto& r : ranges) {
        if (!r || r->game != opt.game) throw std::invalid_argument("Compiled range game does not match simulation");
        if (r->union_mask & blocked) {
            PreparedRange p;
            for (auto c : r->combos) if (!(c.mask & blocked)) p.push_back(c);
            if (p.empty()) throw std::invalid_argument("A player range is empty after card removal");
            r = std::make_shared<CompiledRange>(std::move(p), opt.game);
        }
    }
    Accumulator combined(ranges.size());
    if (opt.game != Game::Holdem) initialize_omaha_table();
    const unsigned missing = unsigned(5 - initial_board.size());
    if (opt.exact) {
        std::vector<const PreparedCombo*> holes(ranges.size());
        std::vector<Card> board = initial_board; std::vector<Value> values(ranges.size());
        // Bound traversal too: impossible heavily overlapping ranges must not hang.
        uint64_t visits = 0;
        uint64_t visit_limit = opt.max_exact > (UINT64_MAX - 1000000) / 100 ? UINT64_MAX : opt.max_exact * 100 + 1000000;
        std::function<void(size_t, Mask, long double)> assign;
        assign = [&](size_t player, Mask used, long double weight) {
            if (++visits > visit_limit) throw std::runtime_error("Exact traversal limit exceeded; narrow ranges or use Monte Carlo");
            if (player < ranges.size()) {
                for (const auto& c : ranges[player]->combos) {
                    if (++visits > visit_limit) throw std::runtime_error("Exact traversal limit exceeded; narrow ranges or use Monte Carlo");
                    if (!(used & c.mask)) { holes[player] = &c; assign(player + 1, used | c.mask, weight * c.weight); }
                }
                return;
            }
            std::vector<Card> available;
            for (unsigned c = 0; c < 52; ++c) if (!(used & (Mask(1) << c))) available.push_back(Card(c));
            std::function<void(unsigned, unsigned)> runouts;
            runouts = [&](unsigned start, unsigned left) {
                if (!left) {
                    if (combined.outcomes >= opt.max_exact) throw std::runtime_error("Exact outcome limit exceeded; increase max_exact or use Monte Carlo");
                    auto prepared_board = prepare_board(opt.game, board.data());
                    for (size_t i = 0; i < holes.size(); ++i) values[i] = evaluate_prepared(opt.game, holes[i]->hole, prepared_board);
                    combined.add(values, weight); return;
                }
                for (unsigned j = start; j + left <= available.size(); ++j) {
                    board.push_back(available[j]); runouts(j + 1, left - 1); board.pop_back();
                }
            };
            runouts(0, missing);
        };
        assign(0, blocked, 1);
        return combined.finish(true);
    }
    unsigned workers = unsigned(std::min<uint64_t>(opt.threads, opt.samples));
    uint64_t total_limit = opt.max_attempts ? opt.max_attempts :
        std::max<uint64_t>(100000, opt.samples > UINT64_MAX / 100 ? UINT64_MAX : opt.samples * 100);
    if (total_limit < opt.samples) throw std::invalid_argument("max_attempts cannot be smaller than samples");
    std::vector<Accumulator> partial; std::vector<std::exception_ptr> errors(workers);
    for (unsigned t = 0; t < workers; ++t) partial.emplace_back(ranges.size());
    auto work = [&](unsigned t) {
        try {
            auto& acc = partial[t]; std::mt19937_64 rng(mix(opt.seed + t));
            uint64_t target = opt.samples / workers + (t < opt.samples % workers);
            uint64_t limit = total_limit / workers + (t < total_limit % workers);
            std::vector<const PreparedCombo*> holes(ranges.size()); std::vector<Value> values(ranges.size());
            std::vector<Card> board = initial_board; board.resize(5);
            FastBoard fixed_board;
            if (!missing) fixed_board = prepare_board(opt.game, board.data());
            while (acc.outcomes < target) {
                if (acc.attempts >= limit) throw std::runtime_error("Monte Carlo attempt limit exceeded: ranges may be incompatible or too heavily overlapping; narrow ranges, use exact, or increase max_attempts");
                ++acc.attempts; Mask used = blocked; bool legal = true;
                // Reject the whole independently sampled tuple, never just one player.
                for (size_t i = 0; i < holes.size(); ++i) {
                    const auto& c = ranges[i]->combos[ranges[i]->draw(rng)]; holes[i] = &c;
                    if (used & c.mask) { legal = false; break; }
                    used |= c.mask;
                }
                if (!legal) continue;
                if (missing) {
                    for (unsigned j = 0; j < missing; ++j) {
                        unsigned c;
                        do { c = std::uniform_int_distribution<unsigned>(0, 51)(rng); } while (used & (Mask(1) << c));
                        used |= Mask(1) << c; board[initial_board.size() + j] = Card(c);
                    }
                }
                auto prepared_board = missing ? prepare_board(opt.game, board.data()) : fixed_board;
                for (size_t i = 0; i < holes.size(); ++i) values[i] = evaluate_prepared(opt.game, holes[i]->hole, prepared_board);
                acc.add(values, 1);
            }
        } catch (...) { errors[t] = std::current_exception(); }
    };
    // Joining in the exceptional path avoids std::terminate if thread creation fails.
    std::vector<std::thread> threads;
    try { for (unsigned t = 1; t < workers; ++t) threads.emplace_back(work, t); }
    catch (...) { for (auto& t : threads) t.join(); throw; }
    work(0);
    for (auto& t : threads) t.join();
    for (auto e : errors) if (e) std::rethrow_exception(e);
    for (const auto& acc : partial) combined.merge(acc);
    return combined.finish(false);
}
} // namespace poker
